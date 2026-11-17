# Onboarding a client

A client is an **organization**. Its data is isolated from other clients in the database (RLS). This cannot be bypassed, even by a bug in the app code.

## Without touching code (from the app)

| What | Where |
|---|---|
| Create the organization and invite its first administrator | `/admin` → *New organization* (name, URL slug, currency, time zone, admin email) |
| Enable or remove modules: Inventory, Sales, Purchasing | `/admin` → the organization's checkboxes → *Save modules*. Sales and Purchasing need Inventory |
| Change name, currency or time zone | The client's admin, in *Settings* |
| Invite users and assign a role (admin, member, read-only) | The client's admin, in *Settings* |
| Suspend or reactivate | `/admin` → *Suspend*. Data is kept and its users can no longer see it |
| Appearance (light/dark, glass, palette) | Each user, with the palette button in the top bar (saved in their browser) |

`/admin` is only visible to platform administrators. The first one is registered with SQL (`deploy.md` §1.9).

## With environment variables (Vercel, no code changes)

- `NEXT_PUBLIC_APP_NAME`: product name in titles, on the sign-in screen and as the email sender.
- `EMAIL_FROM`: full sender, for example `My Brand <notices@my-domain.com>`.
- Full list of variables: `.env.example`.

## Changes that do require code

| Typical request | What to touch |
|---|---|
| A new module (for example, Payroll) | One line in `src/lib/modules.ts`, its pages with `requireModule(ctx, "<id>")`, an entry in `NAV` (`src/components/shell/sidebar.tsx`) and a migration that adds the id to the `organizations_modules_known` check (`src/db/schema.ts` → `npx drizzle-kit generate`) |
| A new field on products, customers, etc. | Column in `src/db/schema.ts` → `npx drizzle-kit generate` → `grant insert/update (<column>)` to `authenticated` in a `--custom` migration. Drizzle names every column in the INSERT, so the grant is mandatory. Then: the form and the action with its Zod validation |
| A new indicator or chart on the Summary | `src/server/metrics.ts` (it is ONE SQL statement: add a sub-select, not another query) and `src/app/o/[orgSlug]/page.tsx` |
| A new table | Follow the pattern of `drizzle/0007_purchases.sql` + `0008_purchases_security.sql`: RLS by `org_id`, audit, triggers that force the sensitive fields and `security definer` functions for state changes. With the audit trigger the table already updates the live screens |

Every database change is a migration in `drizzle/` and is applied automatically on deploy (`deploy.yml`). Migrations are *expand/contract*: never drop or rename a column in the same deploy as the code that stops using it.

## How everything stays up to date (so you don't break it)

- Actions are Server Actions with `revalidatePath`: the view updates in place, without reloading.
- Any audited write (from any user or tab) sends a data-free notice to the private Realtime channel `org:<id>`. `LiveUpdates` (`src/components/shell/live-updates.tsx`) responds with `router.refresh()`. This is done by the `broadcast_org_change` trigger on `audit_log` (migration `0009`). A new table only needs its audit trigger.
- Performance: each page opens ONE transaction. Its first statement (`private.app_context`) sets the identity and checks membership. Rule: **few, large statements per request**. Through the pooler, each statement with parameters costs two round trips.

## Before the first paying client

See `deploy.md` (*Plans*): Supabase Pro (daily backups and PITR), Vercel Pro (commercial use), Sentry, CSP with a nonce, and your own domain and SMTP (Resend). **The Vercel region (`vercel.json` → `regions`) must be the same as Supabase's.** Today it is `iad1` = `us-east-1`. If they do not match, every query pays ~70 ms extra.
