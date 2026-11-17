# Production deployment (one-time setup and flow)

Production is deployed **only** from GitHub Actions (`.github/workflows/deploy.yml`): green CI on `main` → migrations → `vercel deploy --prod` → smoke test. `vercel.json` disables Vercel's auto-deploy of `main`; PR previews remain automatic.

## One time only

### 1. Supabase (production project, separate from development)
1. Create the project. Note the `project ref` and the region. The region of the Vercel functions (`vercel.json` → `regions`, currently `iad1` = `us-east-1`) must be the same; otherwise every query pays the distance (~70 ms per round trip).
2. **Authentication → Signing Keys**: enable asymmetric keys (`getClaims()` needs them).
3. **Authentication → Providers → Email**: *Confirm email* on. *Signups* on (the invitation flow creates the account), but the UI offers no sign-up without a token. Auth rate limits on.
4. **Authentication → URL Configuration**: Site URL = production URL; Redirect URLs = `<URL>/auth/confirm`.
5. **Authentication → Email Templates**: "Confirm signup" → `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`; "Reset password" → same with `&type=recovery`.
6. **Authentication → SMTP**: Resend, with a verified domain (SPF/DKIM). Without a domain, email only reaches team members.
7. **Settings → Data API**: remove `public` from the exposed schemas (the app only uses supabase-js for Auth and Realtime).
7b. **Realtime → Settings**: leave private channels allowed (the live screens use the private channel `org:<id>`, authorized by RLS on `realtime.messages`, migration `0009`).
8. First migration and app role (from your machine, with the pooler's session connection, port 5432):
   ```bash
   DATABASE_URL_MIGRATE='postgresql://postgres.<ref>:<db-password>@<pooler-host>:5432/postgres' npm run db:migrate
   DATABASE_URL='postgresql://app_rls.<ref>:<new-password>@<pooler-host>:6543/postgres' \
   DATABASE_URL_MIGRATE='postgresql://postgres.<ref>:<db-password>@<pooler-host>:5432/postgres' node scripts/db-setup-role.ts
   ```
   (`db-setup-role.ts` reads `.env.local`; for production export the variables in the terminal or use a temporary `.env.local` that you delete afterwards.) Never paste passwords into a chat.
9. Register the first platform administrator with SQL: `insert into platform_admins (user_id) values ('<user uuid>');`

### 2. Vercel
1. Import the repository. Framework: Next.js. **Build Command:** `next build --webpack` (or leave the default if you prefer Turbopack; CI uses webpack).
2. **Production** environment variables (and the Preview ones pointing to the development database):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL` (`app_rls` role, pooler 6543), `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`, `EMAIL_FROM` and, if you want a different product name, `NEXT_PUBLIC_APP_NAME`.
   **Do not** define `SUPABASE_SERVICE_ROLE_KEY` or `DATABASE_URL_MIGRATE` (the deploy checks for them and fails if they exist: AC23).
3. Create a token (Account Settings → Tokens). With `npx vercel link` get `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (`.vercel/project.json`).

### 3. GitHub (Settings → Secrets and variables → Actions)
| Name | Type | Value |
|---|---|---|
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | secret | from Vercel |
| `PROD_DATABASE_URL_MIGRATE` | secret | `postgres` connection through the **session** pooler (5432) |
| `AGE_PUBLIC_KEY` | secret | `age` public key (see `restore-backup.md`) |
| `DEMO_VIEWER_PASSWORD`, `SEED_ADMIN_PASSWORD` | secret | demo passwords (optional) |
| `PROD_URL` | variable | `https://your-domain` (no trailing `/`) |
| `DEMO_ENABLED` | variable | `true` for the nightly demo reset |

Create the `production` environment (Settings → Environments) and, if you want, require manual approval before each deploy.

## Every deploy
1. PR → CI (`ci.yml`): lint, typecheck, AC22, build + AC23, unit, integration and e2e tests against an ephemeral local Supabase.
2. Merge to `main` → CI → `deploy.yml`: checks that Vercel has no bypass credentials, migrates, deploys and tests `/api/health`, login, redirects and headers.
3. If a migration fails, there is no deploy. There are no "down" migrations: fix forward. Migrations are *expand/contract*: never drop or rename a column in the same deploy as the code that stops using it.

## Portfolio demo
`node scripts/seed.ts --yes` recreates the `demo` organization with sample data. With `DEMO_ENABLED=true` the `demo-reset.yml` workflow does it every night (it also resets the demo user's password and profile). To show the credentials on the login page, define `NEXT_PUBLIC_DEMO_EMAIL` and `NEXT_PUBLIC_DEMO_PASSWORD` in Vercel.

## Plans
Supabase free pauses inactive projects and has no PITR; Vercel Hobby is for non-commercial use only and keeps logs for a very short time. Acceptable for the portfolio demo. **With the first paying client: Supabase Pro, Vercel Pro, Sentry, a CSP with a nonce, and remove `backup.yml`.**
