# Backups and restore

While the project is on Supabase's free plan (no PITR), `.github/workflows/backup.yml` runs a `pg_dump` (custom format) of the `public` and `auth` schemas every night, encrypts it with `age` and stores it as a private GitHub Actions artifact for 14 days. Without `auth`, users could not sign in after a restore. When moving to Supabase Pro (daily backups included), remove that workflow.

## Prepare the keys (once)
```bash
brew install age
age-keygen -o age-key.txt          # prints the public key (age1...)
```
- The **public key** goes into the `AGE_PUBLIC_KEY` GitHub secret.
- The **private key** (`age-key.txt`) is kept **outside** the repository and the project (password manager). Without it the backups cannot be opened; anyone who has it can read them.

## What the backup contains
A custom-format `pg_dump` of the `public` (tables, data, policies), `private` (the RLS helper functions: without them no policy works), `auth` (users: without it nobody can sign in) and `drizzle` (migration history) schemas **with** their privileges (the per-column GRANTs are part of the security model). Owners are omitted (`--no-owner`): everything ends up owned by the user who restores (`postgres`), which is what the `security definer` functions need.

## Restore
1. Download the artifact of the chosen run (Actions → Nightly backup → Artifacts) and unzip it.
2. Decrypt:
   ```bash
   age -d -i age-key.txt backup-YYYY-MM-DD.dump.age > backup.dump
   ```
3. Restore into a **new, empty** project or database (never on top of production without backing up first). Use `pg_restore` 17 or later (e.g. with Docker, installing nothing):
   ```bash
   docker run --rm -i postgres:17 pg_restore --no-owner \
     --dbname "$DATABASE_URL_MIGRATE" < backup.dump
   ```
   **Do not use `--clean`**: with `DROP POLICY IF EXISTS` on tables that do not exist yet it produces dozens of false errors. Expected: `pg_restore: warning: errors ignored on restore: 7`, which are exactly `CREATE SCHEMA public` (already exists) and six `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_*` (`permission denied`; those values already come with any Supabase project). Any other error must be investigated.
4. Recreate the app role (roles are not in the backup) and set its password:
   ```sql
   create role app_rls login nobypassrls;
   grant authenticated to app_rls;
   ```
   ```bash
   node scripts/db-setup-role.ts   # with DATABASE_URL (app_rls) and DATABASE_URL_MIGRATE pointing to the restored project
   ```
5. Check: `/api/health`, sign in with a known user and compare counts with the source (`auth.users`, `organizations`, `products`, `orders`). Better still: `npm test` with both URLs pointing to the restored database (in the test below, all 106 passed).
6. Delete the unencrypted `backup.dump`.

## Restore test
Done on 2026-10-14 locally (Supabase CLI + Docker): the demo organization was seeded, dumped with the workflow's command, restored into an empty database and the counts were compared (2 users, 1 organization, 24 products, 70 orders, 195 movements, 28 policies, 10 `private` functions, 20 privileges, 7 migrations: identical to the source). Then `npm test` against the restored database: 106 of 106. A first attempt with `public` + `auth` and `--no-privileges` (the workflow's original version) **would have left the app unusable** (no `private` functions or privileges); that is why the `private` schema and the privileges are now included.

Pending: repeat it once against a real Supabase project (the development one) before relying on it, and repeat it after large schema changes (if you add another schema of your own, add it to the `pg_dump`).
