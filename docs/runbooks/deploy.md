# Despliegue a producción (configuración única y flujo)

Producción se despliega **solo** desde GitHub Actions (`.github/workflows/deploy.yml`): CI en verde sobre `main` → migraciones → `vercel deploy --prod` → prueba de humo. `vercel.json` desactiva el auto-deploy de `main` en Vercel; los previews de PR siguen automáticos.

## Una sola vez

### 1. Supabase (proyecto de producción, separado del de desarrollo)
1. Crear el proyecto. Anotar el `project ref` y la región. La región de las funciones de Vercel (`vercel.json` → `regions`, hoy `iad1` = `us-east-1`) debe ser la misma; si no, cada consulta paga la distancia (~70 ms por ida y vuelta).
2. **Authentication → Signing Keys**: activar claves asimétricas (`getClaims()` las necesita).
3. **Authentication → Providers → Email**: *Confirm email* activado. *Signups* activados (el flujo de invitación crea la cuenta), pero la UI no ofrece registro sin token. Rate limits de Auth activados.
4. **Authentication → URL Configuration**: Site URL = URL de producción; Redirect URLs = `<URL>/auth/confirm`.
5. **Authentication → Email Templates**: "Confirm signup" → `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`; "Reset password" → igual con `&type=recovery`.
6. **Authentication → SMTP**: Resend, con el dominio verificado (SPF/DKIM). Sin dominio el correo solo llega a miembros del equipo.
7. **Settings → Data API**: quitar `public` de los esquemas expuestos (la app solo usa supabase-js para Auth y para Realtime).
7b. **Realtime → Settings**: dejar los canales privados permitidos (las pantallas en vivo usan el canal privado `org:<id>`, autorizado por RLS en `realtime.messages`, migración `0009`).
8. Primera migración y rol de la app (desde tu máquina, con la conexión de sesión del pooler, puerto 5432):
   ```bash
   DATABASE_URL_MIGRATE='postgresql://postgres.<ref>:<db-password>@<pooler-host>:5432/postgres' npm run db:migrate
   DATABASE_URL='postgresql://app_rls.<ref>:<nueva-password>@<pooler-host>:6543/postgres' \
   DATABASE_URL_MIGRATE='postgresql://postgres.<ref>:<db-password>@<pooler-host>:5432/postgres' node scripts/db-setup-role.ts
   ```
   (`db-setup-role.ts` lee `.env.local`; para producción exporta las variables en la terminal o usa un `.env.local` temporal que borres después.) Nunca pegues contraseñas en un chat.
9. Dar de alta al primer administrador de plataforma por SQL: `insert into platform_admins (user_id) values ('<uuid del usuario>');`

### 2. Vercel
1. Importar el repositorio. Framework: Next.js. **Build Command:** `next build --webpack` (o deja el predeterminado si prefieres Turbopack; CI usa webpack).
2. Variables de entorno de **Production** (y las de Preview apuntando a la base de desarrollo):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` (rol `app_rls`, pooler 6543), `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`, `EMAIL_FROM` y, si quieres otro nombre de producto, `NEXT_PUBLIC_APP_NAME`.
   **No** definir `SUPABASE_SERVICE_ROLE_KEY` ni `DATABASE_URL_MIGRATE` (el deploy lo verifica y falla si existen: AC23).
3. Crear un token (Account Settings → Tokens). Con `npx vercel link` obtener `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` (`.vercel/project.json`).

### 3. GitHub (Settings → Secrets and variables → Actions)
| Nombre | Tipo | Valor |
|---|---|---|
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | secret | de Vercel |
| `PROD_DATABASE_URL_MIGRATE` | secret | conexión `postgres` por el pooler de **sesión** (5432) |
| `AGE_PUBLIC_KEY` | secret | clave pública de `age` (ver `restore-backup.md`) |
| `DEMO_VIEWER_PASSWORD`, `SEED_ADMIN_PASSWORD` | secret | contraseñas de la demo (opcional) |
| `PROD_URL` | variable | `https://tu-dominio` (sin `/` final) |
| `DEMO_ENABLED` | variable | `true` para el reset nocturno de la demo |

Crear el entorno `production` (Settings → Environments) y, si quieres, exigir aprobación manual antes de cada deploy.

## Cada deploy
1. PR → CI (`ci.yml`): lint, typecheck, AC22, build + AC23, pruebas unitarias, de integración y e2e contra un Supabase local efímero.
2. Merge a `main` → CI → `deploy.yml`: verifica que Vercel no tenga credenciales con bypass, migra, despliega y prueba `/api/health`, login, redirecciones y cabeceras.
3. Si una migración falla, no hay deploy. No hay migraciones "down": se corrige hacia adelante. Las migraciones son *expand/contract*: nunca borrar ni renombrar una columna en el mismo deploy que el código que deja de usarla.

## Demo de portafolio
`node scripts/seed.ts --yes` recrea la organización `demo` con datos de ejemplo. Con `DEMO_ENABLED=true` el workflow `demo-reset.yml` lo hace cada noche (restablece también la contraseña y el perfil del usuario demo). Para mostrar las credenciales en el login, define `NEXT_PUBLIC_DEMO_EMAIL` y `NEXT_PUBLIC_DEMO_PASSWORD` en Vercel.

## Planes
Supabase free pausa proyectos inactivos y no tiene PITR; Vercel Hobby es solo para uso no comercial y guarda los logs muy poco tiempo. Aceptable para la demo de portafolio. **Con el primer cliente que pague: Supabase Pro, Vercel Pro, Sentry, una CSP con nonce y retirar `backup.yml`.**
