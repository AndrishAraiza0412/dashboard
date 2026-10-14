import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

// Runtime connection: role app_rls (NOBYPASSRLS) through Supavisor transaction mode.
// Import only from with-org.ts (enforced by ESLint).
const client = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3 });

export const db = drizzle(client, { schema });
