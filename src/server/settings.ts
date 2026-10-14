import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { invitations, memberships, profiles } from "@/db/schema";
import type { Tx } from "@/server/db/rls";

export const listMembers = (tx: Tx, orgId: string) =>
  tx
    .select({ userId: memberships.userId, role: memberships.role, email: profiles.email, fullName: profiles.fullName })
    .from(memberships)
    .leftJoin(profiles, eq(profiles.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(asc(profiles.email));

/** RLS only lets org admins read invitations. */
export const listPendingInvitations = (tx: Tx, orgId: string) =>
  tx
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(and(eq(invitations.orgId, orgId), isNull(invitations.acceptedAt)))
    .orderBy(asc(invitations.email));
