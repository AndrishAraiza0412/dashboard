// Purchase orders list, with creation of a new order or a restock order (requires the purchases module).
import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { dateTime, money } from "@/lib/format";
import { choice, pageParam, query, sizeParam } from "@/lib/params";
import { createPurchaseOrder, createRestockOrder } from "@/server/actions/purchases";
import { listPurchaseOrders, poNumber, PURCHASE_STATUSES, PURCHASE_TONES, type PurchaseStatus } from "@/server/purchases";
import { loadOrg, requireModule } from "@/server/db/with-org";

export const metadata = { title: "Compras" };

export default function PurchasesPage({ params, searchParams }: PageProps<"/o/[orgSlug]/purchases">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Pick<PageProps<"/o/[orgSlug]/purchases">, "params" | "searchParams">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const status = choice(sp.status, ["", ...(Object.keys(PURCHASE_STATUSES) as PurchaseStatus[])] as const, "");
  const size = sizeParam(sp.size);
  const page = pageParam(sp.page);

  const {
    ctx,
    data: { rows, total },
  } = await loadOrg(orgSlug, "viewer", async (tx, ctx) => {
    await requireModule(ctx, "purchases");
    return listPurchaseOrders(tx, ctx.orgId, { status: status || undefined, page, size });
  });

  const base = `/o/${orgSlug}/purchases`;
  const href = (over: { status?: string; page?: number } = {}) =>
    `${base}${query({ status: "status" in over ? over.status : status, size, page: over.page && over.page > 1 ? over.page : undefined }, { size: 20 })}`;
  const pages = Math.max(1, Math.ceil(total / size));
  const canEdit = ctx.role !== "viewer";

  return (
    <div className="fade-in">
      <PageHeader
        title="Compras"
        description={`${total} ${total === 1 ? "orden de compra" : "órdenes de compra"} a proveedores`}
        actions={
          <>
            <Link href={`${base}/suppliers`} className="inline-flex h-10 items-center rounded-md border border-hairline bg-canvas px-5 text-sm font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors duration-150 hover:bg-surface-soft">
              Proveedores
            </Link>
            {canEdit && (
              <>
                <form action={createRestockOrder.bind(null, orgSlug)}>
                  <Button type="submit">Reponer stock bajo</Button>
                </form>
                <form action={createPurchaseOrder.bind(null, orgSlug)}>
                  <Button type="submit" variant="primary">Nueva orden</Button>
                </form>
              </>
            )}
          </>
        }
      />

      <nav aria-label="Filtrar por estado" className="mb-4 flex w-fit flex-wrap gap-1 rounded-full border border-hairline bg-surface-soft p-1">
        {[["", "Todas"], ...Object.entries(PURCHASE_STATUSES)].map(([key, label]) => (
          <Link
            key={key}
            href={href({ status: key })}
            aria-current={status === key ? "true" : undefined}
            className="rounded-full px-4 py-1.5 text-[13px] text-body transition-[color,background-color,box-shadow] duration-150 hover:text-ink aria-[current=true]:bg-canvas aria-[current=true]:font-medium aria-[current=true]:text-ink aria-[current=true]:shadow-sm"
          >
            {label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          title={status ? "Sin órdenes con ese estado" : "Aún no hay órdenes de compra"}
          description={canEdit && !status ? "Crea una orden para pedir mercancía a un proveedor. El stock sube cuando la marques como recibida." : undefined}
          action={status ? <Link href={base} className="text-sm font-medium text-primary-text underline">Quitar filtro</Link> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-canvas shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">Órdenes de compra</caption>
            <thead className="bg-surface-soft">
              <tr>
                {["Orden", "Proveedor", "Fecha", "Piezas", "Estado", "Total"].map((h, i) => (
                  <th key={h} scope="col" className={`px-4 py-3 text-[12px] font-medium uppercase tracking-wide text-muted ${i === 3 || i === 5 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-t border-hairline-soft transition-colors duration-150 hover:bg-surface-soft/60">
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link href={`${base}/${o.id}`} className="font-medium text-ink underline-offset-2 hover:underline">{poNumber(o.number)}</Link>
                  </td>
                  <td className="px-4 py-3 text-ink">{o.supplier ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{dateTime(o.createdAt, ctx.timezone)}</td>
                  <td className="tabular px-4 py-3 text-right text-ink">{o.items}</td>
                  <td className="px-4 py-3"><Badge tone={PURCHASE_TONES[o.status]}>{PURCHASE_STATUSES[o.status]}</Badge></td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-right font-medium text-ink">{money(o.total, ctx.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pages={pages} total={total} href={(p) => href({ page: p })} />
    </div>
  );
}
