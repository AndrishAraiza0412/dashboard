# Copias de seguridad y restauración

Mientras el proyecto esté en el plan gratuito de Supabase (sin PITR), `.github/workflows/backup.yml` hace cada noche un `pg_dump` (formato custom) de los esquemas `public` y `auth`, lo cifra con `age` y lo guarda como artifact privado de GitHub Actions durante 14 días. Sin `auth`, los usuarios no podrían iniciar sesión tras restaurar. Al pasar a Supabase Pro (backups diarios incluidos), elimina ese workflow.

## Preparar las claves (una vez)
```bash
brew install age
age-keygen -o age-key.txt          # imprime la clave pública (age1...)
```
- La **clave pública** va al secreto `AGE_PUBLIC_KEY` de GitHub.
- La **clave privada** (`age-key.txt`) se guarda **fuera** del repositorio y del proyecto (gestor de contraseñas). Sin ella los respaldos no se pueden abrir; cualquiera que la tenga puede leerlos.

## Restaurar
1. Descargar el artifact de la ejecución elegida (Actions → Nightly backup → Artifacts) y descomprimirlo.
2. Descifrar:
   ```bash
   age -d -i age-key.txt backup-YYYY-MM-DD.dump.age > backup.dump
   ```
3. Restaurar en un proyecto **vacío** (nunca encima de producción sin respaldar antes). Necesitas `pg_restore` de la versión 17 o superior:
   ```bash
   pg_restore --no-owner --no-privileges --clean --if-exists \
     --dbname "$DATABASE_URL_MIGRATE" backup.dump
   ```
   Los errores sobre objetos que ya existen del esquema `auth` gestionado por Supabase son esperables; revisa que no haya otros.
4. Volver a fijar la contraseña del rol de la app: `node scripts/db-setup-role.ts`.
5. Comprobar: `/api/health`, iniciar sesión con un usuario conocido y contar filas de `organizations` y `products`.
6. Borrar `backup.dump` en claro.

## Prueba de restauración
Hay que probar este procedimiento **una vez** contra el proyecto de desarrollo (o un proyecto de pruebas) antes de confiar en él, y repetirlo después de cambios grandes de esquema. Estado: **pendiente** (ver `.omc/handoff.md`).
