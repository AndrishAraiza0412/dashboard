import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { auditLog, profiles } from "@/db/schema";
import type { Tx } from "@/server/db/rls";
import type { Action, Entity } from "@/lib/activity-text";

/** RLS only lets organization admins read audit_log, so callers should ask for it from admin pages only. */
export async function listActivity(tx: Tx, orgId: string, f: { entity?: Entity; action?: Action; page: number; size: number }) {
  const where = and(eq(auditLog.orgId, orgId), f.entity ? eq(auditLog.entity, f.entity) : undefined, f.action ? eq(auditLog.action, f.action) : undefined);
  const rows = await tx
      .select({
        rowCount: sql<number>`(count(*) over())::int`,
        id: auditLog.id,
        action: auditLog.action,
        entity: auditLog.entity,
        diff: auditLog.diff,
        createdAt: auditLog.createdAt,
        // display name; without one, the part of the email before "@"
        actor: sql<string | null>`coalesce(nullif(${profiles.fullName}, ''), split_part(${profiles.email}, '@', 1))`,
      })
      .from(auditLog)
      .leftJoin(profiles, eq(profiles.id, auditLog.actorId))
      .where(where)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(f.size)
      .offset((f.page - 1) * f.size);
  const total = rows[0]?.rowCount ?? (f.page > 1 ? (await tx.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(where))[0].total : 0);
  return { rows, total };
}
