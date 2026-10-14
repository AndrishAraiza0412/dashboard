import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { dateTime, money } from "@/lib/format";
import { createOrder } from "@/server/actions/sales";
import { listOrders, ORDERS_PAGE, STATUSES, TONES, type Status } from "@/server/sales";
import { requireMembership, requireModule, withOrg } from "@/server/db/with-org";

export const metadata = { title: "Ventas" };

export default function SalesPage({ params, searchParams }: PageProps<"/o/[orgSlug]/sales">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Pick<PageProps<"/o/[orgSlug]/sales">, "params" | "searchParams">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireMembership(orgSlug);
  await requireModule(ctx, "sales");

  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status = (Object.keys(STATUSES) as Status[]).find((s) => s === raw);
  const page = Math.max(1, Math.floor(Number(Array.isArray(sp.page) ? sp.page[0] : sp.page)) || 1);
  const { rows, total } = await withOrg(orgSlug, (tx) => listOrders(tx, ctx.orgId, { status, page }));

  const base = `/o/${orgSlug}/sales`;
  const pages = Math.max(1, Math.ceil(total / ORDERS_PAGE));
  const href = (s: string | undefined, p = 1) => `${base}?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;
  const canEdit = ctx.role !== "viewer";

  return (
    <>
      <PageHeader
        title="Ventas"
        description={`${total} ${total === 1 ? "pedido" : "pedidos"}`}
        actions={
          <>
            <Link href={`${base}/customers`} className="inline-flex h-10 items-center rounded-md border border-hairline px-5 text-sm font-medium text-ink hover:bg-surface-soft">
              Clientes
            </Link>
            {canEdit && (
              <form action={createOrder.bind(null, orgSlug)}>
                <Button type="submit" variant="primary">Nuevo pedido</Button>
              </form>
            )}
          </>
        }
      />

      <nav aria-label="Filtrar por estado" className="mb-4 flex flex-wrap gap-2">
        {[["", "Todos"], ...Object.entries(STATUSES)].map(([key, label]) => (
          <Link
            key={key}
            href={href(key || undefined)}
            aria-current={(status ?? "") === key ? "true" : undefined}
            className="rounded-full border border-hairline px-4 py-1.5 text-[13px] text-ink hover:bg-surface-soft aria-[current=true]:bg-surface-card aria-[current=true]:font-medium"
          >
            {label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState title={status ? "Sin pedidos en este estado" : "Aún no hay pedidos"} description={canEdit && !status ? "Crea un pedido para empezar a vender." : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-canvas">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <caption className="sr-only">Pedidos</caption>
            <thead className="bg-surface-soft">
              <tr>
                {["Pedido", "Cliente", "Fecha", "Estado", "Total"].map((h, i) => (
                  <th key={h} scope="col" className={`px-4 py-3 text-[13px] font-medium text-muted ${i === 4 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-t border-hairline-soft hover:bg-surface-soft/60">
                  <td className="px-4 py-3">
                    <Link href={`${base}/${o.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                      {o.number ? `#${o.number}` : "Borrador"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink">{o.customer ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{dateTime(o.createdAt, ctx.timezone)}</td>
                  <td className="px-4 py-3"><Badge tone={TONES[o.status]}>{STATUSES[o.status]}</Badge></td>
                  <td className="tabular px-4 py-3 text-right text-ink">{money(o.total, ctx.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Paginación" className="mt-4 flex items-center justify-between text-[13px] text-muted">
          <span>Página {page} de {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link href={href(status, page - 1)} className="rounded-md border border-hairline px-4 py-2 text-ink hover:bg-surface-soft">Anterior</Link>}
            {page < pages && <Link href={href(status, page + 1)} className="rounded-md border border-hairline px-4 py-2 text-ink hover:bg-surface-soft">Siguiente</Link>}
          </span>
        </nav>
      )}
    </>
  );
}
