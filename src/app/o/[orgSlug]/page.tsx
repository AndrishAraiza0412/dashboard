import Link from "next/link";
import { Suspense } from "react";
import { ActivityList } from "@/components/shell/activity-list";
import { BarList } from "@/components/ui/bar-list";
import { ColumnChart } from "@/components/ui/bar-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/ui/chart-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { RevenueLine } from "@/components/ui/line-chart";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { dateTime, money } from "@/lib/format";
import { one, query } from "@/lib/params";
import { listActivity } from "@/server/activity";
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
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg bg-surface-card" />)}
      </div>
      <div className="h-80 rounded-lg bg-surface-card" />
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

      {sales && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <nav aria-label="Periodo" className="flex flex-wrap gap-2">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Link
                key={r}
                href={href({ range: r })}
                aria-current={r === activeRange ? "true" : undefined}
                className="rounded-full border border-hairline px-4 py-1.5 text-[13px] text-ink transition-colors duration-150 hover:bg-surface-soft aria-[current=true]:bg-surface-card aria-[current=true]:font-medium"
              >
                {RANGE_LABELS[r]}
              </Link>
            ))}
          </nav>
          <details className="relative" open={m.custom}>
            <summary
              className="cursor-pointer list-none rounded-full border border-hairline px-4 py-1.5 text-[13px] text-ink transition-colors duration-150 hover:bg-surface-soft aria-[current=true]:bg-surface-card [&::-webkit-details-marker]:hidden"
              aria-current={m.custom ? "true" : undefined}
            >
              Personalizado
            </summary>
            <form method="get" action={base} className="absolute left-0 z-10 mt-2 flex w-[min(92vw,420px)] flex-wrap items-end gap-3 rounded-lg border border-hairline bg-canvas p-4 shadow-sm">
              <input type="hidden" name="range" value="custom" />
              {!compare && <input type="hidden" name="compare" value="0" />}
              <Field id="from" name="from" label="Desde" type="date" defaultValue={m.from} max={m.to} required className="w-40" />
              <Field id="to" name="to" label="Hasta" type="date" defaultValue={m.to} required className="w-40" />
              <Button type="submit" variant="primary">Aplicar</Button>
            </form>
          </details>
          <Link
            href={href({ range: m.custom ? "custom" : rangeParam, from: m.custom ? m.from : undefined, to: m.custom ? m.to : undefined, compare: compare ? "0" : undefined })}
            className="ml-auto text-[13px] text-body underline underline-offset-2"
          >
            {compare ? "Ocultar comparación" : "Comparar con el periodo anterior"}
          </Link>
        </div>
      )}

      {sales && (
        <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Ingresos" value={fmt(m.revenue)} {...revenue} hint="vs. periodo anterior" />
          <StatTile label="Pedidos" value={String(m.orders)} {...orders} hint={m.customersServed ? `${m.customersServed} ${m.customersServed === 1 ? "cliente" : "clientes"}` : "vs. periodo anterior"} />
          <StatTile label="Ticket promedio" value={m.avgTicket === null ? "—" : fmt(m.avgTicket)} {...ticket} hint="vs. periodo anterior" />
          <StatTile label="Margen estimado" value={fmt(m.margin)} hint={m.marginPct === null ? "sin ventas" : `${m.marginPct}% de los ingresos`} />
        </div>
      )}
      {inventory && (
        <div className={`stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${sales ? "mt-4" : ""}`}>
          <StatTile label="Valor del inventario" value={fmt(m.inventory.stockValue)} hint="a costo" />
          <StatTile label="Productos activos" value={String(m.inventory.active)} />
          <StatTile label="Stock bajo" value={String(m.lowStock.count)} hint={m.lowStock.count === 1 ? "producto" : "productos"} />
          <StatTile label="Agotados" value={String(m.inventory.outOfStock)} hint={m.inventory.outOfStock === 1 ? "producto" : "productos"} />
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
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                      <span className="min-w-0">
                        <Link href={`${base}/sales/${o.id}`} className="font-medium text-ink underline-offset-2 hover:underline">{o.number ? `#${o.number}` : "Borrador"}</Link>
                        <span className="text-muted"> · {o.customer ?? "Sin cliente"}</span>
                        <span className="block text-[13px] text-muted">{dateTime(o.createdAt, ctx.timezone)}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <Badge tone={TONES[o.status as keyof typeof TONES]}>{STATUSES[o.status as keyof typeof STATUSES]}</Badge>
                        <span className="tabular text-ink">{fmt(o.total)}</span>
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
