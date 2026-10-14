import Link from "next/link";
import { Suspense } from "react";
import { BarList } from "@/components/ui/bar-list";
import { ChartCard } from "@/components/ui/chart-card";
import { EmptyState } from "@/components/ui/empty-state";
import { RevenueLine } from "@/components/ui/line-chart";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { money } from "@/lib/format";
import { getMetrics, parseRange, type Range } from "@/server/metrics";
import { requireMembership, withOrg } from "@/server/db/with-org";

export const metadata = { title: "Resumen" };

const RANGE_LABELS: Record<Range, string> = { "7d": "7 días", "30d": "30 días", "90d": "90 días", year: "Este año" };

export default function OrgHome({ params, searchParams }: PageProps<"/o/[orgSlug]">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando resumen" className="animate-pulse space-y-6">
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

// one query batch for the whole page, so an error shows the route's error boundary instead of a
// per-card error; split into separate Suspense/error boundaries per card if one query gets slow or flaky.
async function Content({ params, searchParams }: Pick<PageProps<"/o/[orgSlug]">, "params" | "searchParams">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireMembership(orgSlug);
  const range = parseRange(Array.isArray(sp.range) ? sp.range[0] : sp.range);
  const m = await withOrg(orgSlug, (tx) => getMetrics(tx, ctx, range));

  const sales = ctx.modules.includes("sales");
  const inventory = ctx.modules.includes("inventory");
  const fmt = (v: string) => money(v, ctx.currency);
  const pct = m.revenueChangePct === null ? null : Number(m.revenueChangePct);
  const base = `/o/${orgSlug}`;

  return (
    <>
      <PageHeader title={ctx.name} description={sales ? `${day(m.from)} – ${day(m.to)}` : "Resumen del inventario"} />

      {sales && (
        <nav aria-label="Periodo" className="mb-6 flex flex-wrap gap-2">
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
            <Link
              key={r}
              href={`${base}?range=${r}`}
              aria-current={r === range ? "true" : undefined}
              className="rounded-full border border-hairline px-4 py-1.5 text-[13px] text-ink hover:bg-surface-soft aria-[current=true]:bg-surface-card aria-[current=true]:font-medium"
            >
              {RANGE_LABELS[r]}
            </Link>
          ))}
        </nav>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sales && (
          <>
            <StatTile
              label="Ingresos"
              value={fmt(m.revenue)}
              delta={pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`}
              trend={pct === null || pct === 0 ? "flat" : pct > 0 ? "up" : "down"}
              hint="vs. periodo anterior"
            />
            <StatTile label="Pedidos" value={String(m.orders)} />
            <StatTile label="Ticket promedio" value={m.avgTicket === null ? "—" : fmt(m.avgTicket)} />
          </>
        )}
        {inventory && <StatTile label="Stock bajo" value={String(m.lowStock.count)} hint={m.lowStock.count === 1 ? "producto" : "productos"} />}
      </div>

      {sales && (
        <div className="mt-6 space-y-6">
          <ChartCard title="Ingresos" description={m.bucket === "week" ? "Por semana (inicia el lunes)" : "Por día"}>
            {m.orders === 0 ? (
              <EmptyState title="Sin ventas en este periodo" description="Confirma un pedido para ver aquí tus ingresos." />
            ) : (
              <RevenueLine data={m.series.map((p) => ({ label: day(p.date), value: Number(p.value) }))} currency={ctx.currency} />
            )}
          </ChartCard>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Productos más vendidos" description="Top 5 por ingresos">
              {m.topProducts.length === 0 ? <p className="text-muted">Sin datos en este periodo.</p> : <BarList items={m.topProducts.map((p) => ({ name: p.name, value: p.revenue }))} format={fmt} />}
            </ChartCard>
            <ChartCard title="Ventas por categoría">
              {m.byCategory.length === 0 ? <p className="text-muted">Sin datos en este periodo.</p> : <BarList items={m.byCategory.map((p) => ({ name: p.name, value: p.revenue }))} format={fmt} />}
            </ChartCard>
          </div>
        </div>
      )}

      {inventory && (
        <div className="mt-6">
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
        </div>
      )}
    </>
  );
}
