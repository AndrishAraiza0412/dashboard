import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import type { ModuleId } from "@/lib/modules";
import { requireClaims } from "@/server/auth";
import { db } from "./client";
import { assertAuthenticated, runAsUser, type Claims, type Tx } from "./rls";

export type Role = "admin" | "member" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

export class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
  }
}

/** The only entry point to the database: runs as the verified user so RLS decides what is visible. */
export async function withUser<T>(fn: (tx: Tx, claims: Claims) => Promise<T>): Promise<T> {
  const claims = await requireClaims();
  const requestId = (await headers()).get("x-request-id") ?? undefined;
  return runAsUser(db, claims, (tx) => fn(tx, claims), requestId);
}

export type OrgContext = {
  orgId: string;
  slug: string;
  name: string;
  currency: string;
  timezone: string;
  modules: string[];
  role: Role;
  userId: string;
};

type Membership = { slug: string; name: string; role: Role };
type AppContext = { org: OrgContext | null; orgs: Membership[] };

/**
 * private.app_context (migration 0009) sets the verified claims and returns the membership for `slug` plus all of
 * the user's organizations, in ONE statement (each statement through the pooler costs two round trips).
 * Suspended organizations are invisible, as with RLS.
 */
const contextSql = (claims: Claims, slug: string | null) => sql`private.app_context(${JSON.stringify(claims)}, ${slug})`;

/** No membership (or a suspended org) is a 404 so existence is not revealed; too low a role throws. */
function checkRole(org: OrgContext | null, minRole: Role): OrgContext {
  if (!org) notFound();
  if (RANK[org.role] < RANK[minRole]) throw new ForbiddenError();
  return org;
}

/** One read-only statement, no transaction: the definer function does not need the authenticated role. */
const readContext = cache(async (slug: string | null): Promise<AppContext> => {
  const claims = await requireClaims();
  assertAuthenticated(claims);
  const [row] = await db.execute<{ ctx: AppContext }>(sql`select ${contextSql(claims, slug)} as ctx`);
  return row.ctx;
});

/**
 * Authorization for Server Actions and route handlers under /o/[orgSlug] (pages use loadOrg, which does the same
 * check inside the page's own transaction). The org id comes from the verified membership, never from client input.
 */
export const requireMembership = cache(
  async (slug: string, minRole: Role = "viewer"): Promise<OrgContext> => checkRole((await readContext(slug)).org, minRole),
);

/**
 * For pages: ONE transaction whose first statement sets the role and request id and checks the membership, then
 * runs `fn` with the verified context under RLS.
 */
export async function loadOrg<T>(
  slug: string,
  minRole: Role,
  fn: (tx: Tx, ctx: OrgContext) => Promise<T>,
): Promise<{ ctx: OrgContext; data: T }> {
  const claims = await requireClaims();
  assertAuthenticated(claims);
  const requestId = (await headers()).get("x-request-id") ?? "";
  return db.transaction(async (tx) => {
    const [row] = await tx.execute<{ ctx: AppContext }>(
      sql`select set_config('role', 'authenticated', true), set_config('app.request_id', ${requestId}, true), ${contextSql(claims, slug)} as ctx`,
    );
    const ctx = checkRole(row.ctx.org, minRole);
    return { ctx, data: await fn(tx, ctx) };
  });
}

/** Everything the org layout needs (membership + the user's organizations), in one statement. */
export const getShell = cache(async (slug: string) => {
  const { org, orgs } = await readContext(slug);
  return { ctx: checkRole(org, "viewer"), orgs };
});

/** For Server Actions of a module the organization has switched off. */
export async function requireModule(ctx: OrgContext, module: ModuleId) {
  if (!ctx.modules.includes(module)) notFound();
}

export const listMyOrgs = cache(async () => (await readContext(null)).orgs);

/** Connectivity probe for /api/health: no user context, returns nothing but ok/error. */
export async function pingDb(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
