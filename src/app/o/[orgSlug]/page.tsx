import Link from "next/link";
import { Suspense } from "react";
import { ActivityList } from "@/components/shell/activity-list";
import { BarList } from "@/components/ui/bar-list";
import { ColumnChart } from "@/components/ui/bar-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/ui/chart-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { Field } from "@/components/ui/input";
import { RevenueLine } from "@/components/ui/line-chart";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { dateTime, money } from "@/lib/format";
import { one, query } from "@/lib/params";
import { listActivity } from "@/server/activity";
import { createRestockOrder } from "@/server/actions/purchases";
import { getMetrics, parseRange, RANGES, type Range } from "@/server/metrics";
import { STATUSES, TONES } from "@/server/sales";
import { loadOrg } from "@/server/db/with-org";

export const metadata = { title: "Resumen" };

const RANGE_LABELS: Record<Range, string> = { "7d": "7 días", "30d": "30 días", "90d": "90 días", year: "Este año" };
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export default function OrgHome({ params, searchParams }: PageProps<"/o/[orgSlug]">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Skeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando resumen" className="animate-pulse space-y-6">
      <div className="h-10 w-64 rounded-md bg-surface-card" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-32 rounded-xl bg-surface-card" />)}
      </div>
      <div className="h-80 rounded-xl bg-surface-card" />
    </div>
  );
}

// A date-only string is shown as-is (UTC), never shifted by the viewer's zone.
const day = (d: string) => new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** "+12.5%" with the matching arrow; "—" when there is no previous period to compare with. */
const change = (pct: string | null) => {
  if (pct === null) return { delta: "—", trend: "flat" as const };
  const n = Number(pct);
  return { delta: `${n > 0 ? "+" : ""}${pct}%`, trend: n === 0 ? ("flat" as const) : n > 0 ? ("up" as const) : ("down" as const) };
};

// one query batch for the whole page, so an error shows the route's error boundary instead of a
// per-card error; split into separate Suspense/error boundaries per card if one query gets slow or flaky.
async function Content({ params, searchParams }: Pick<PageProps<"/o/[orgSlug]">, "params" | "searchParams">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const rangeParam = one(sp.range);
  const range = parseRange(rangeParam, one(sp.from), one(sp.to));
  const compare = one(sp.compare) !== "0";

  const {
    ctx,
    data: { m, activity },
  } = await loadOrg(orgSlug, "viewer", async (tx, ctx) => {
    const [m, activity] = await Promise.all([
      getMetrics(tx, ctx, range),
      // the audit trail is admin-only (RLS): do not even ask for other roles
      ctx.role === "admin" ? listActivity(tx, ctx.orgId, { page: 1, size: 6 }) : Promise.resolve(null),
    ]);
    return { m, activity };
  });

  const sales = ctx.modules.includes("sales");
  const inventory = ctx.modules.includes("inventory");
  const fmt = (v: string) => money(v, ctx.currency);
  const base = `/o/${orgSlug}`;
  const href = (p: Record<string, string | undefined>) => `${base}${query({ compare: compare ? undefined : "0", ...p })}`;
  const activeRange = m.custom ? "custom" : (range as Range);
  const revenue = change(m.revenueChangePct);
  const orders = change(m.ordersChangePct);
  const ticket = change(m.avgTicketChangePct);
  const maxOrders = Math.max(...m.ordersByStatus.map((s) => s.count));

  const label = (d: string) => (m.bucket === "week" ? `sem. ${day(d)}` : day(d));
  const chartData = m.series.map((p, i) => ({ label: label(p.date), value: Number(p.value), previous: Number(m.previousSeries[i]?.value ?? 0) }));

  return (
    <div className="fade-in">
      <PageHeader title={ctx.name} description={sales ? `${day(m.from)} – ${day(m.to)}` : "Resumen del inventario"} />

      {inventory && m.lowStock.count > 0 && (
        <section aria-labelledby="low-stock-alert" className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-warning/30 bg-warning-bg px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-canvas text-warning ring-1 ring-warning/30">
            <Icon name="alert" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="low-stock-alert" className="font-medium text-ink">
              {m.lowStock.count === 1 ? "1 producto con stock bajo" : `${m.lowStock.count} productos con stock bajo`}
              {m.inventory.outOfStock > 0 && <span className="text-warning"> · {m.inventory.outOfStock} {m.inventory.outOfStock === 1 ? "agotado" : "agotados"}</span>}
            </h2>
            <p className="mt-0.5 truncate text-[13px] text-body">
              {m.lowStock.items.slice(0, 3).map((p) => `${p.name} (${p.stockQty})`).join(", ")}
              {m.lowStock.count > 3 && ` y ${m.lowStock.count - 3} más`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${base}/inventory?stock=low`} className="inline-flex h-9 items-center rounded-md border border-hairline bg-canvas px-4 text-[13px] font-medium text-ink transition-colors hover:bg-surface-soft">
              Ver productos
            </Link>
            {ctx.role !== "viewer" && ctx.modules.includes("purchases") && (
              <form action={createRestockOrder.bind(null, orgSlug)}>
                <Button type="submit" variant="primary" className="h-9 px-4 text-[13px]">Crear orden de reposición</Button>
              </form>
            )}
          </div>
        </section>
      )}

      {sales && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <nav aria-label="Periodo" className="flex flex-wrap gap-1 rounded-full border border-hairline bg-surface-soft p-1">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Link
                key={r}
                href={href({ range: r })}
                aria-current={r === activeRange ? "true" : undefined}
                className="rounded-full px-4 py-1.5 text-[13px] text-body transition-[color,background-color,box-shadow] duration-150 hover:text-ink aria-[current=true]:bg-canvas aria-[current=true]:font-medium aria-[current=true]:text-ink aria-[current=true]:shadow-sm"
              >
                {RANGE_LABELS[r]}
              </Link>
            ))}
          </nav>
          <details className="relative" open={m.custom}>
            <summary
              className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-hairline bg-canvas px-4 py-2 text-[13px] text-ink transition-colors duration-150 hover:bg-surface-soft aria-[current=true]:border-primary-strong aria-[current=true]:font-medium [&::-webkit-details-marker]:hidden"
              aria-current={m.custom ? "true" : undefined}
            >
              <Icon name="calendar" className="size-4 text-muted" />
              Personalizado
            </summary>
            <form method="get" action={base} className="absolute left-0 z-30 mt-2 flex w-[min(92vw,420px)] flex-wrap items-end gap-3 rounded-xl border border-hairline bg-canvas p-4 shadow-lg">
              <input type="hidden" name="range" value="custom" />
              {!compare && <input type="hidden" name="compare" value="0" />}
              <Field id="from" name="from" label="Desde" type="date" defaultValue={m.from} max={m.to} required className="w-40" />
              <Field id="to" name="to" label="Hasta" type="date" defaultValue={m.to} required className="w-40" />
              <Button type="submit" variant="primary">Aplicar</Button>
            </form>
          </details>
          <Link
            href={href({ range: m.custom ? "custom" : rangeParam, from: m.custom ? m.from : undefined, to: m.custom ? m.to : undefined, compare: compare ? "0" : undefined })}
            className="ml-auto rounded-md px-2 py-1 text-[13px] text-body underline underline-offset-2 transition-colors hover:bg-surface-card hover:text-ink"
          >
            {compare ? "Ocultar comparación" : "Comparar con el periodo anterior"}
          </Link>
        </div>
      )}

      {sales && (
        <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon="dollar" label="Ingresos" value={fmt(m.revenue)} {...revenue} hint="vs. periodo anterior" />
          <StatTile icon="bag" label="Pedidos" value={String(m.orders)} {...orders} hint={m.customersServed ? `${m.customersServed} ${m.customersServed === 1 ? "cliente" : "clientes"}` : "vs. periodo anterior"} />
          <StatTile icon="trend" label="Ticket promedio" value={m.avgTicket === null ? "—" : fmt(m.avgTicket)} {...ticket} hint="vs. periodo anterior" />
          <StatTile icon="percent" label="Margen estimado" value={fmt(m.margin)} hint={m.marginPct === null ? "sin ventas" : `${m.marginPct}% de los ingresos`} />
        </div>
      )}
      {inventory && (
        <div className={`stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${sales ? "mt-4" : ""}`}>
          <StatTile icon="box" label="Valor del inventario" value={fmt(m.inventory.stockValue)} hint="a costo" />
          <StatTile icon="check" label="Productos activos" value={String(m.inventory.active)} />
          <StatTile icon="alert" label="Stock bajo" value={String(m.lowStock.count)} hint={m.lowStock.count === 1 ? "producto" : "productos"} />
          <StatTile icon="ban" label="Agotados" value={String(m.inventory.outOfStock)} hint={m.inventory.outOfStock === 1 ? "producto" : "productos"} />
        </div>
      )}

      {sales && (
        <div className="mt-6 space-y-6">
          <ChartCard title="Ingresos" description={m.bucket === "week" ? "Por semana (inicia el lunes)" : "Por día"}>
            {m.orders === 0 ? (
              <EmptyState title="Sin ventas en este periodo" description="Confirma un pedido para ver aquí tus ingresos." />
            ) : (
              <RevenueLine data={chartData} currency={ctx.currency} compare={compare} />
            )}
          </ChartCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Pedidos por estado" description="Pedidos creados en el periodo">
              {maxOrders === 0 ? (
                <p className="text-muted">Sin pedidos en este periodo.</p>
              ) : (
                <BarList items={m.ordersByStatus.map((s) => ({ name: STATUSES[s.status], value: String(s.count) }))} format={(v) => v} />
              )}
            </ChartCard>
            <ChartCard title="Ventas por día de la semana" description="Ingresos acumulados en el periodo">
              {m.orders === 0 ? (
                <p className="text-muted">Sin datos en este periodo.</p>
              ) : (
                <ColumnChart data={m.byWeekday.map((d) => ({ label: WEEKDAYS[d.day - 1], value: Number(d.revenue), extra: String(d.orders) }))} currency={ctx.currency} label="Ingresos por día de la semana" />
              )}
            </ChartCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Productos más vendidos" description="Top 5 por ingresos">
              {m.topProducts.length === 0 ? <p className="text-muted">Sin datos en este periodo.</p> : <BarList items={m.topProducts.map((p) => ({ name: p.name, value: p.revenue }))} format={fmt} />}
            </ChartCard>
            <ChartCard title="Ventas por categoría">
              {m.byCategory.length === 0 ? <p className="text-muted">Sin datos en este periodo.</p> : <BarList items={m.byCategory.map((p) => ({ name: p.name, value: p.revenue }))} format={fmt} />}
            </ChartCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Mejores clientes" description="Top 5 por ingresos">
              {m.topCustomers.length === 0 ? <p className="text-muted">Sin datos en este periodo.</p> : <BarList items={m.topCustomers.map((p) => ({ name: p.name, value: p.revenue }))} format={fmt} />}
            </ChartCard>
            <ChartCard title="Últimos pedidos" footer={<Link href={`${base}/sales`} className="text-body underline underline-offset-2">Ver todos los pedidos</Link>}>
              {m.recentOrders.length === 0 ? (
                <p className="text-muted">Aún no hay pedidos.</p>
              ) : (
                <ul className="divide-y divide-hairline-soft">
                  {m.recentOrders.map((o) => (
                    <li key={o.id} className="-mx-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md px-2 py-2.5 transition-colors hover:bg-surface-soft">
                      <span className="min-w-0">
                        <Link href={`${base}/sales/${o.id}`} className="font-medium text-ink underline-offset-2 hover:underline">{o.number ? `#${o.number}` : "Borrador"}</Link>
                        <span className="text-muted"> · {o.customer ?? "Sin cliente"}</span>
                        <span className="block text-[13px] text-muted">{dateTime(o.createdAt, ctx.timezone)}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <Badge tone={TONES[o.status as keyof typeof TONES]}>{STATUSES[o.status as keyof typeof STATUSES]}</Badge>
                        <span className="tabular font-medium text-ink">{fmt(o.total)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {inventory && (
          <ChartCard title="Productos con stock bajo" description="Stock igual o menor al nivel de aviso">
            {m.lowStock.items.length === 0 ? (
              <p className="text-muted">Todo el stock está por encima de su nivel de aviso.</p>
            ) : (
              <ul className="divide-y divide-hairline-soft">
                {m.lowStock.items.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-4 py-2">
                    <Link href={`${base}/inventory/${p.id}`} className="truncate text-ink underline-offset-2 hover:underline">{p.name}</Link>
                    <span className="tabular shrink-0 text-muted">{p.stockQty} / aviso {p.reorderLevel}</span>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        )}
        {activity && (
          <ChartCard title="Actividad reciente" footer={<Link href={`${base}/activity`} className="text-body underline underline-offset-2">Ver toda la actividad</Link>}>
            {activity.rows.length === 0 ? <p className="text-muted">Aún no hay actividad.</p> : <ActivityList rows={activity.rows} timezone={ctx.timezone} />}
          </ChartCard>
        )}
      </div>
    </div>
  );
}
