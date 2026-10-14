import "server-only";
import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import type { Tx } from "@/server/db/rls";
import { withUser } from "@/server/db/with-org";

/** Every /admin page and action calls this first; anyone else gets a 404. The database re-checks in each admin_* function. */
export async function requirePlatformAdmin() {
  const ok = await withUser(async (tx) => ((await tx.execute(sql`select private.is_platform_admin() as ok`)) as unknown as { ok: boolean }[])[0].ok);
  if (!ok) notFound();
}

export type AdminOrg = {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  modules: string[];
  suspended: boolean;
  isDemo: boolean;
};

export async function listAllOrgs(tx: Tx): Promise<AdminOrg[]> {
  const rows = (await tx.execute(sql`select id, name, slug, currency, timezone, enabled_modules, suspended_at, is_demo from public.admin_list_orgs()`)) as unknown as {
    id: string; name: string; slug: string; currency: string; timezone: string; enabled_modules: string[]; suspended_at: string | null; is_demo: boolean;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, currency: r.currency, timezone: r.timezone, modules: r.enabled_modules, suspended: r.suspended_at !== null, isDemo: r.is_demo }));
}

/** Platform-admin check and the organization list in one transaction (404 for anyone else). */
export const loadAdminOrgs = () =>
  withUser(async (tx) => {
    const ok = ((await tx.execute(sql`select private.is_platform_admin() as ok`)) as unknown as { ok: boolean }[])[0].ok;
    if (!ok) notFound();
    return listAllOrgs(tx);
  });
