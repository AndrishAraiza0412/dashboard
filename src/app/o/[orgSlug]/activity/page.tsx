import Link from "next/link";
import { Suspense } from "react";
import { ActivityList } from "@/components/shell/activity-list";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectField } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { ACTIONS, ENTITIES, type Action, type Entity } from "@/lib/activity-text";
import { choice, pageParam, PAGE_SIZES, query, sizeParam } from "@/lib/params";
import { listActivity } from "@/server/activity";
import { loadOrg } from "@/server/db/with-org";

export const metadata = { title: "Actividad" };

export default function ActivityPage({ params, searchParams }: PageProps<"/o/[orgSlug]/activity">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Pick<PageProps<"/o/[orgSlug]/activity">, "params" | "searchParams">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const entity = choice(sp.entity, ["", ...(Object.keys(ENTITIES) as Entity[])] as const, "");
  const action = choice(sp.action, ["", ...(Object.keys(ACTIONS) as Action[])] as const, "");
  const size = sizeParam(sp.size);
  const page = pageParam(sp.page);

  // Admins only: the page asks for the admin role, and RLS on audit_log says the same.
  const {
    ctx,
    data: { rows, total },
  } = await loadOrg(orgSlug, "admin", (tx, ctx) => listActivity(tx, ctx.orgId, { entity: entity || undefined, action: action || undefined, page, size }));

  const base = `/o/${orgSlug}/activity`;
  const pages = Math.max(1, Math.ceil(total / size));
  const href = (p: number) => `${base}${query({ entity, action, size, page: p > 1 ? p : undefined }, { size: 20 })}`;
  const filtered = Boolean(entity || action);

  return (
    <div className="fade-in">
      <PageHeader title="Actividad" description="Quién cambió qué en la organización" />
      <form method="get" action={base} role="search" className="mb-4 grid gap-3 sm:grid-cols-[200px_160px_120px_auto] sm:items-end">
        <SelectField id="entity" name="entity" label="Qué" defaultValue={entity}>
          <option value="">Todo</option>
          {Object.entries(ENTITIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
        <SelectField id="action" name="action" label="Acción" defaultValue={action}>
          <option value="">Todas</option>
          {Object.entries(ACTIONS).map(([v, l]) => <option key={v} value={v}>{l[0].toUpperCase() + l.slice(1)}</option>)}
        </SelectField>
        <SelectField id="size" name="size" label="Por página" defaultValue={String(size)}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <div className="flex gap-2">
          <Button type="submit">Filtrar</Button>
          {filtered && <Link href={base} className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-body hover:bg-surface-card">Quitar filtros</Link>}
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={filtered ? "Sin resultados" : "Aún no hay actividad"} description={filtered ? "Prueba con otros filtros." : "Los cambios que se hagan aparecerán aquí."} />
      ) : (
        <div className="rounded-lg border border-hairline px-4">
          <ActivityList rows={rows} timezone={ctx.timezone} />
        </div>
      )}
      <Pagination page={page} pages={pages} total={total} href={href} />
    </div>
  );
}
