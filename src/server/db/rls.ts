import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type Claims = {
  sub: string;
  role: string;
  email?: string;
  aal?: string;
  session_id?: string;
  [key: string]: unknown;
};

type Db = PostgresJsDatabase<Record<string, unknown>>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `fn` in one transaction as the Postgres `authenticated` role with the
 * caller's verified JWT claims, so RLS decides what rows are visible.
 * Claims must come from a verified source (supabase.auth.getClaims()).
 */
export function runAsUser<T>(
  db: Db,
  claims: Claims,
  fn: (tx: Tx) => Promise<T>,
  requestId?: string,
): Promise<T> {
  if (claims.role !== "authenticated" || !claims.sub) {
    throw new Error("runAsUser: claims are not from an authenticated user");
  }
  return db.transaction(async (tx) => {
    // One statement, one round trip (each trip to the hosted database costs ~70 ms). Bound parameters, never
    // string-built SQL. set_config('role', ..., true) is SET LOCAL ROLE: it checks membership the same way.
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
                 set_config('app.request_id', ${requestId ?? ""}, true),
                 set_config('role', 'authenticated', true)`,
    );
    return fn(tx);
  });
}
