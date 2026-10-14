// Sets the app_rls password from DATABASE_URL so it never lives in a migration file.
// Run after migrations: npx tsx scripts/db-setup-role.ts
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const runtimeUrl = new URL(process.env.DATABASE_URL!);
const password = decodeURIComponent(runtimeUrl.password);
const admin = postgres(process.env.DATABASE_URL_MIGRATE!, { prepare: false, max: 1, connect_timeout: 15 });

try {
  const [{ current_user }] = await admin`select current_user`;
  console.log(`connected as ${current_user}`);
  const [role] = await admin`select 1 from pg_roles where rolname = 'app_rls'`;
  if (!role) throw new Error("role app_rls does not exist yet: run npm run db:migrate first");
  // ALTER ROLE takes no bind parameters; quote the literal.
  await admin.unsafe(`alter role app_rls password '${password.replaceAll("'", "''")}'`);
  console.log("app_rls password set");
} catch (e) {
  const err = e as { code?: string; message: string };
  console.error("ERROR", err.code ?? "", err.message);
  process.exitCode = 1;
} finally {
  await admin.end();
}
