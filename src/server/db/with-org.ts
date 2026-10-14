import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { memberships, organizations } from "@/db/schema";
import { requireClaims } from "@/server/auth";
import { db } from "./client";
import { runAsUser, type Claims, type Tx } from "./rls";

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

const membershipIn = async (tx: Tx, userId: string, slug: string, minRole: Role): Promise<OrgContext> => {
  const [row] = await tx
    .select({
      orgId: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      currency: organizations.currency,
      timezone: organizations.timezone,
      modules: organizations.enabledModules,
      role: memberships.role,
      userId: memberships.userId,
    })
    .from(organizations)
    .innerJoin(memberships, eq(memberships.orgId, organizations.id))
    .where(and(eq(organizations.slug, slug), eq(memberships.userId, userId)))
    .limit(1);
  if (!row) notFound();
  if (RANK[row.role] < RANK[minRole]) throw new ForbiddenError();
  return row;
};

/**
 * Authorization for Server Actions and route handlers under /o/[orgSlug] (pages use loadOrg, which does the same
 * check inside the page's own transaction). The org id comes from the verified membership, never from client
 * input. No membership (or a suspended org) is a 404 so existence is not revealed; too low a role throws.
 */
export const requireMembership = cache(
  (slug: string, minRole: Role = "viewer"): Promise<OrgContext> => withUser((tx, claims) => membershipIn(tx, claims.sub, slug, minRole)),
);

/**
 * For pages: ONE transaction that checks the membership and then runs `fn` with the verified context, instead of a
 * membership transaction followed by a data transaction (each costs several round trips to the database).
 */
export async function loadOrg<T>(
  slug: string,
  minRole: Role,
  fn: (tx: Tx, ctx: OrgContext) => Promise<T>,
): Promise<{ ctx: OrgContext; data: T }> {
  return withUser(async (tx, claims) => {
    const ctx = await membershipIn(tx, claims.sub, slug, minRole);
    return { ctx, data: await fn(tx, ctx) };
  });
}

/** Everything the org layout needs, in one transaction (membership + the user's organizations). */
export const getShell = cache((slug: string) =>
  withUser(async (tx, claims) => {
    const ctx = await membershipIn(tx, claims.sub, slug, "viewer");
    const orgs = await tx
      .select({ slug: organizations.slug, name: organizations.name })
      .from(organizations)
      .innerJoin(memberships, eq(memberships.orgId, organizations.id))
      .where(eq(memberships.userId, claims.sub))
      .orderBy(organizations.name);
    return { ctx, orgs };
  }),
);

/** For Server Actions of a module the organization has switched off. */
export async function requireModule(ctx: OrgContext, module: "inventory" | "sales") {
  if (!ctx.modules.includes(module)) notFound();
}

export const listMyOrgs = cache(() =>
  withUser((tx, claims) =>
    tx
      .select({ slug: organizations.slug, name: organizations.name, role: memberships.role })
      .from(organizations)
      .innerJoin(memberships, eq(memberships.orgId, organizations.id))
      .where(eq(memberships.userId, claims.sub))
      .orderBy(organizations.name),
  ),
);

/** Connectivity probe for /api/health: no user context, returns nothing but ok/error. */
export async function pingDb(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
