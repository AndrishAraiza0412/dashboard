# Copias de seguridad y restauración

Mientras el proyecto esté en el plan gratuito de Supabase (sin PITR), `.github/workflows/backup.yml` hace cada noche un `pg_dump` (formato custom) de los esquemas `public` y `auth`, lo cifra con `age` y lo guarda como artifact privado de GitHub Actions durante 14 días. Sin `auth`, los usuarios no podrían iniciar sesión tras restaurar. Al pasar a Supabase Pro (backups diarios incluidos), elimina ese workflow.

## Preparar las claves (una vez)
```bash
brew install age
age-keygen -o age-key.txt          # imprime la clave pública (age1...)
```
- La **clave pública** va al secreto `AGE_PUBLIC_KEY` de GitHub.
- La **clave privada** (`age-key.txt`) se guarda **fuera** del repositorio y del proyecto (gestor de contraseñas). Sin ella los respaldos no se pueden abrir; cualquiera que la tenga puede leerlos.

## Qué contiene el respaldo
`pg_dump` en formato custom de los esquemas `public` (tablas, datos, políticas), `private` (las funciones auxiliares de RLS: sin ellas ninguna política funciona), `auth` (usuarios: sin él nadie puede iniciar sesión), `drizzle` (historial de migraciones) **con** sus permisos (los GRANT por columna son parte del modelo de seguridad). Se omiten los dueños (`--no-owner`): todo queda a nombre del usuario que restaura (`postgres`), que es lo que necesitan las funciones `security definer`.

## Restaurar
1. Descargar el artifact de la ejecución elegida (Actions → Nightly backup → Artifacts) y descomprimirlo.
2. Descifrar:
   ```bash
   age -d -i age-key.txt backup-YYYY-MM-DD.dump.age > backup.dump
   ```
3. Restaurar en un proyecto o base **nueva y vacía** (nunca encima de producción sin respaldar antes). Usa `pg_restore` 17 o superior (p. ej. con Docker, sin instalar nada):
   ```bash
   docker run --rm -i postgres:17 pg_restore --no-owner \
     --dbname "$DATABASE_URL_MIGRATE" < backup.dump
   ```
   **No uses `--clean`**: con `DROP POLICY IF EXISTS` sobre tablas que aún no existen produce decenas de errores falsos. Esperado: `pg_restore: warning: errors ignored on restore: 7`, que son exactamente `CREATE SCHEMA public` (ya existe) y seis `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_*` (`permission denied`; esos valores ya vienen en cualquier proyecto Supabase). Cualquier otro error hay que investigarlo.
4. Recrear el rol de la app (los roles no van en el respaldo) y fijar su contraseña:
   ```sql
   create role app_rls login nobypassrls;
   grant authenticated to app_rls;
   ```
   ```bash
   node scripts/db-setup-role.ts   # con DATABASE_URL (app_rls) y DATABASE_URL_MIGRATE apuntando al proyecto restaurado
   ```
5. Comprobar: `/api/health`, iniciar sesión con un usuario conocido y comparar conteos con el origen (`auth.users`, `organizations`, `products`, `orders`). Mejor aún: `npm test` con las dos URLs apuntando a la base restaurada (en la prueba de abajo pasaron las 106).
6. Borrar `backup.dump` en claro.

## Prueba de restauración
Hecha el 2026-10-14 en local (Supabase CLI + Docker): se sembró la organización demo, se volcó con el comando del workflow, se restauró en una base vacía y se compararon conteos (2 usuarios, 1 organización, 24 productos, 70 pedidos, 195 movimientos, 28 políticas, 10 funciones de `private`, 20 permisos, 7 migraciones: idénticos al origen). Después `npm test` contra la base restaurada: 106 de 106. Un primer intento con `public` + `auth` y `--no-privileges` (la versión original del workflow) **habría dejado la app inservible** (sin funciones `private` ni permisos); por eso el esquema `private` y los permisos ahora van incluidos.

Pendiente: repetirla una vez contra un proyecto Supabase real (el de desarrollo) antes de depender de ella, y repetirla tras cambios grandes de esquema (si añades otro esquema propio, añádelo al `pg_dump`).
