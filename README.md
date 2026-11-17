# Dashboard — multi-client sales and inventory

Multi-organization SaaS (Inventory, Sales and Purchasing, with modules that can be enabled per client; live screens with Supabase Realtime). The UI is in Spanish (es-MX). MVP without billing.

**Stack:** Next.js 16 (App Router, Cache Components) · strict TypeScript · Supabase (Postgres + Auth) · Drizzle · Tailwind v4 · TanStack Table · Recharts · Zod · Vitest · Playwright + axe.

## How it is designed

- **Client isolation in the database.** The app connects as `app_rls` (without `BYPASSRLS`) and every request runs inside `withOrg()`: `set local role authenticated` plus the claims verified with `getClaims()`. If a query forgets `withOrg`, it returns 0 rows, not another client's data. There is no bypass credential in production.
- **Anything sensitive lives in Postgres.** Stock, order numbering and totals, roles, invitations and platform administration are `security definer` functions or triggers; grants are per column.
- **Authorization at every boundary.** Every page, Server Action and route handler calls `requireMembership(slug, role)`; the layout is not a security boundary.
- Design and contrast: [`docs/design.md`](docs/design.md).

## Getting started

```bash
npm install
cp .env.example .env.local        # fill in with your development Supabase project
npm run db:migrate                # applies drizzle/*.sql (DATABASE_URL_MIGRATE)
node scripts/db-setup-role.ts     # sets the app_rls password from DATABASE_URL
node scripts/seed.ts --yes        # optional: demo organization with sample data
npx next dev --webpack -p 3100
```

## Commands

| | |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint / types |
| `npm test` | Integration tests against real Postgres (isolation, permissions, stock, KPIs) |
| `npx playwright test` | E2E with axe, 375 px and keyboard (starts its own server) |
| `npx next build --webpack` | Production build |
| `node scripts/seed.ts --yes \| --clean` | Create / remove the demo organization |

## Operations

- Deployment and configuration: [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md)
- Backups: [`docs/runbooks/restore-backup.md`](docs/runbooks/restore-backup.md)
- Onboarding a client (and which changes require code): [`docs/runbooks/new-client.md`](docs/runbooks/new-client.md)
- Deleting an organization: [`docs/runbooks/delete-org.md`](docs/runbooks/delete-org.md)
