import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { runAsUser, type Claims } from "@/server/db/rls";

// Phase 0 go/no-go spike: app_rls through Supavisor transaction mode must isolate orgs.
const admin = postgres(process.env.DATABASE_URL_MIGRATE!, { prepare: false, max: 1 });
const runtime = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3 });
const db = drizzle(runtime, { schema });

const run = randomUUID().slice(0, 8);
const userA = randomUUID();
const userB = randomUUID();
const viewer = randomUUID();
let orgA: string;
let orgB: string;

// Drizzle wraps driver errors ("Failed query: ..."); the Postgres message is on `cause`.
const pgMessage = (e: unknown) => String((e as { cause?: Error }).cause?.message ?? (e as Error).message);

const claims = (sub: string): Claims => ({
  sub,
  role: "authenticated",
  email: `${sub}@test.local`,
  aal: "aal1",
  session_id: randomUUID(),
});

beforeAll(async () => {
  for (const id of [userA, userB, viewer]) {
    await admin`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`${id}@test.local`}, '', now(), '{}', '{}', now(), now())`;
  }
  [{ id: orgA }] = await admin`insert into organizations (name, slug) values ('A', ${`a-${run}`}) returning id`;
  [{ id: orgB }] = await admin`insert into organizations (name, slug) values ('B', ${`b-${run}`}) returning id`;
  await admin`insert into memberships (org_id, user_id, role) values
    (${orgA}, ${userA}, 'admin'), (${orgB}, ${userB}, 'admin'), (${orgA}, ${viewer}, 'viewer')`;
  await admin`insert into categories (org_id, name) values (${orgA}, 'cat-a'), (${orgB}, 'cat-b')`;
});

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    await admin.begin(async (tx) => {
      await tx`select set_config('app.deleting_org', ${id}, true)`;
      await tx`delete from organizations where id = ${id}`;
    });
    await admin`delete from audit_log where org_id = ${id}`;
  }
  await admin`delete from auth.users where id in (${userA}, ${userB}, ${viewer})`;
  await admin.end();
  await runtime.end();
});

describe("tenant isolation (Phase 0 spike)", () => {
  it("connects as app_rls without BYPASSRLS", async () => {
    const [row] = await runtime`select current_user as u, rolbypassrls from pg_roles where rolname = current_user`;
    expect(row.u).toBe("app_rls");
    expect(row.rolbypassrls).toBe(false);
  });

  it("a user only sees their own org's rows", async () => {
    const rows = await runAsUser(db, claims(userA), (tx) => tx.select().from(schema.categories));
    expect(rows.map((r) => r.name)).toEqual(["cat-a"]);
    const orgs = await runAsUser(db, claims(userA), (tx) => tx.select().from(schema.organizations));
    expect(orgs.map((o) => o.id)).toEqual([orgA]);
  });

  it("a user cannot write into another org", async () => {
    const err = await runAsUser(db, claims(userA), (tx) =>
      tx.insert(schema.categories).values({ orgId: orgB, name: "x" }),
    ).catch((e) => e);
    expect(pgMessage(err)).toMatch(/row-level security/);

    const updated = await runAsUser(db, claims(userA), (tx) =>
      tx.update(schema.categories).set({ name: "hacked" }).where(eq(schema.categories.orgId, orgB)).returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await runAsUser(db, claims(userA), (tx) =>
      tx.delete(schema.categories).where(eq(schema.categories.orgId, orgB)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("a viewer cannot write in their own org", async () => {
    const err = await runAsUser(db, claims(viewer), (tx) =>
      tx.insert(schema.categories).values({ orgId: orgA, name: "v" }),
    ).catch((e) => e);
    expect(pgMessage(err)).toMatch(/row-level security/);
  });

  it("a query outside runAsUser sees 0 rows (fails closed)", async () => {
    for (const table of ["organizations", "memberships", "categories"]) {
      const [{ n }] = await runtime.unsafe(`select count(*)::int as n from public.${table}`);
      expect(n, table).toBe(0);
    }
  });

  it("claims do not leak between pooled transactions", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const user = i % 2 === 0 ? userA : userB;
        return runAsUser(db, claims(user), async (tx) => {
          const [{ uid }] = await tx.execute<{ uid: string }>(sql`select auth.uid()::text as uid`);
          const rows = await tx.select().from(schema.categories);
          return { user, uid, names: rows.map((r) => r.name) };
        });
      }),
    );
    for (const r of results) {
      expect(r.uid).toBe(r.user);
      expect(r.names).toEqual([r.user === userA ? "cat-a" : "cat-b"]);
    }
    const [{ n }] = await runtime`select count(*)::int as n from public.categories`;
    expect(n).toBe(0);
  });

  it("rejects claims that are not from an authenticated user", () => {
    expect(() => runAsUser(db, { sub: userA, role: "anon" }, async () => null)).toThrow();
  });
});
