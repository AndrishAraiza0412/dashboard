// Sales orders list, with creation of a new order (requires the sales module).
import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectField } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { dateTime, money } from "@/lib/format";
import { choice, isIsoDay, isUuid, one, pageParam, PAGE_SIZES, query, sizeParam } from "@/lib/params";
import { createOrder } from "@/server/actions/sales";
import { listCustomers, listOrders, ORDER_SORTS, STATUSES, TONES, type OrderSort, type Status } from "@/server/sales";
import { loadOrg, requireModule } from "@/server/db/with-org";

export const metadata = { title: "Ventas" };

export default function SalesPage({ params, searchParams }: PageProps<"/o/[orgSlug]/sales">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Pick<PageProps<"/o/[orgSlug]/sales">, "params" | "searchParams">) {
  const { orgSlug } = await params;
  const sp = await searchParams;

  const status = choice(sp.status, ["", ...(Object.keys(STATUSES) as Status[])] as const, "");
  const customer = one(sp.customer);
  const customerId = isUuid(customer) ? customer : undefined;
  const from = isIsoDay(one(sp.from)) ? one(sp.from) : undefined;
  const to = isIsoDay(one(sp.to)) ? one(sp.to) : undefined;
  const sort = choice(sp.sort, Object.keys(ORDER_SORTS) as OrderSort[], "date_desc");
  const size = sizeParam(sp.size);
  const page = pageParam(sp.page);

  const {
    ctx,
    data: [{ rows, total }, customers],
  } = await loadOrg(orgSlug, "viewer", async (tx, ctx) => {
    await requireModule(ctx, "sales");
    return Promise.all([
      listOrders(tx, ctx.orgId, { status: status || undefined, customerId, from, to, sort, timezone: ctx.timezone, page, size }),
      listCustomers(tx, ctx.orgId),
    ]);
  });

  const base = `/o/${orgSlug}/sales`;
  const defaults = { sort: "date_desc", size: 20 };
  const href = (over: { status?: string; page?: number } = {}) =>
    `${base}${query({ status: "status" in over ? over.status : status, customer: customerId, from, to, sort, size, page: over.page && over.page > 1 ? over.page : undefined }, defaults)}`;
  const pages = Math.max(1, Math.ceil(total / size));
  const canEdit = ctx.role !== "viewer";
  const filtered = Boolean(status || customerId || from || to);

  return (
    <div className="fade-in">
      <PageHeader
        title="Ventas"
        description={`${total} ${total === 1 ? "pedido" : "pedidos"}`}
        actions={
          <>
            <Link href={`${base}/customers`} className="inline-flex h-10 items-center rounded-md border border-hairline px-5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-soft">
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
            href={href({ status: key })}
            aria-current={status === key ? "true" : undefined}
            className="rounded-full border border-hairline px-4 py-1.5 text-[13px] text-ink transition-colors duration-150 hover:bg-surface-soft aria-[current=true]:bg-surface-card aria-[current=true]:font-medium"
          >
            {label}
          </Link>
        ))}
      </nav>

      <form method="get" action={base} role="search" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_160px_160px_1fr_110px_auto] lg:items-end">
        {status && <input type="hidden" name="status" value={status} />}
        <SelectField id="customer" name="customer" label="Cliente" defaultValue={customerId ?? ""}>
          <option value="">Todos</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <Field id="from" name="from" label="Desde" type="date" defaultValue={from} max={to} />
        <Field id="to" name="to" label="Hasta" type="date" defaultValue={to} min={from} />
        <SelectField id="sort" name="sort" label="Ordenar por" defaultValue={sort}>
          {Object.entries(ORDER_SORTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
        <SelectField id="size" name="size" label="Por página" defaultValue={String(size)}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <Button type="submit">Filtrar</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "Sin pedidos con esos filtros" : "Aún no hay pedidos"}
          description={canEdit && !filtered ? "Crea un pedido para empezar a vender." : undefined}
          action={filtered ? <Link href={base} className="text-sm font-medium text-primary-strong underline">Quitar filtros</Link> : undefined}
        />
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
                <tr key={o.id} className="border-t border-hairline-soft transition-colors duration-150 hover:bg-surface-soft/60">
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link href={`${base}/${o.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                      {o.number ? `#${o.number}` : "Borrador"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink">{o.customer ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{dateTime(o.createdAt, ctx.timezone)}</td>
                  <td className="px-4 py-3"><Badge tone={TONES[o.status]}>{STATUSES[o.status]}</Badge></td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-right text-ink">{money(o.total, ctx.currency)}</td>
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
