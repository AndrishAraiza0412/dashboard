# Dashboard — ventas e inventario multi-cliente

SaaS multi-organización (Inventario, Ventas y Compras, módulos activables por cliente; pantallas en vivo con Supabase Realtime). UI en español (es-MX). MVP sin cobros.

**Stack:** Next.js 16 (App Router, Cache Components) · TypeScript estricto · Supabase (Postgres + Auth) · Drizzle · Tailwind v4 · TanStack Table · Recharts · Zod · Vitest · Playwright + axe.

## Cómo está pensado

- **Aislamiento entre clientes en la base de datos.** La app se conecta como `app_rls` (sin `BYPASSRLS`) y cada petición corre dentro de `withOrg()`: `set local role authenticated` más las claims verificadas con `getClaims()`. Si una consulta se olvida de `withOrg`, devuelve 0 filas, no datos de otro cliente. No existe ninguna credencial con bypass en producción.
- **Lo sensible vive en Postgres.** Stock, numeración y totales de pedidos, roles, invitaciones y administración de plataforma son funciones `security definer` o triggers; los grants son por columna.
- **Autorización en cada frontera.** Cada página, Server Action y route handler llama a `requireMembership(slug, rol)`; el layout no es una frontera de seguridad.
- Diseño y contraste: [`docs/design.md`](docs/design.md).

## Puesta en marcha

```bash
npm install
cp .env.example .env.local        # rellena con tu proyecto Supabase de desarrollo
npm run db:migrate                # aplica drizzle/*.sql (DATABASE_URL_MIGRATE)
node scripts/db-setup-role.ts     # fija la contraseña de app_rls desde DATABASE_URL
node scripts/seed.ts --yes        # opcional: organización demo con datos de ejemplo
npx next dev --webpack -p 3100
```

## Comandos

| | |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint / tipos |
| `npm test` | Pruebas de integración contra Postgres real (aislamiento, permisos, stock, KPIs) |
| `npx playwright test` | E2E con axe, 375 px y teclado (levanta su propio servidor) |
| `npx next build --webpack` | Build de producción |
| `node scripts/seed.ts --yes \| --clean` | Crear / quitar la organización demo |

## Operación

- Despliegue y configuración: [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md)
- Copias de seguridad: [`docs/runbooks/restore-backup.md`](docs/runbooks/restore-backup.md)
- Dar de alta un cliente (y qué cambios piden código): [`docs/runbooks/new-client.md`](docs/runbooks/new-client.md)
- Borrar una organización: [`docs/runbooks/delete-org.md`](docs/runbooks/delete-org.md)
