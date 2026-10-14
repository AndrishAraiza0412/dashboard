import { sql } from "drizzle-orm";
import type { Tx } from "@/server/db/rls";

export const RANGES = { "7d": 7, "30d": 30, "90d": 90, year: 0 } as const;
export type Range = keyof typeof RANGES;
export const parseRange = (v: string | undefined): Range => (v && v in RANGES ? (v as Range) : "30d");

export type Metrics = {
  from: string; // first local day of the period (YYYY-MM-DD)
  to: string; // last local day of the period
  revenue: string;
  revenueChangePct: string | null; // null when the previous period had no revenue
  orders: number;
  avgTicket: string | null; // null with 0 orders
  series: { date: string; value: string }[]; // day buckets, or ISO weeks (Monday) for `year`
  bucket: "day" | "week";
  topProducts: { name: string; revenue: string }[];
  byCategory: { name: string; revenue: string }[];
  lowStock: { count: number; items: { id: string; name: string; stockQty: number; reorderLevel: number }[] };
};

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fmt(parse(d) + n * DAY);
const mondayOf = (d: string) => addDays(d, -((new Date(parse(d)).getUTCDay() + 6) % 7));
/** Calendar day of `now` in the organization's time zone. */
const localDay = (now: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);

/**
 * Confirmed + fulfilled orders by `confirmed_at`, bucketed in the organization's time zone.
 * Periods are whole local days ending today; the previous period has the same length. `now` is a
 * parameter so tests can pin the date. Money stays a string (numeric) until display.
 */
export async function getMetrics(tx: Tx, org: { orgId: string; timezone: string }, range: Range, now = new Date()): Promise<Metrics> {
  const { orgId, timezone: tz } = org;
  const today = localDay(now, tz);
  const start = range === "year" ? `${today.slice(0, 4)}-01-01` : addDays(today, 1 - RANGES[range]);
  const end = addDays(today, 1); // exclusive
  const len = (parse(end) - parse(start)) / DAY;
  const prevStart = addDays(start, -len);

  // local midnight of a YYYY-MM-DD as timestamptz
  const at = (d: string) => sql`(${d}::date)::timestamp at time zone ${tz}`;
  const counted = sql`o.org_id = ${orgId} and o.status in ('confirmed', 'fulfilled')`;
  const inPeriod = sql`o.confirmed_at >= ${at(start)} and o.confirmed_at < ${at(end)}`;
  const rows = async <T>(q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

  const [totals] = await rows<{ revenue: string; orders: number; prev_revenue: string }>(sql`
    select coalesce(sum(o.total) filter (where o.confirmed_at >= ${at(start)}), 0)::text as revenue,
           (count(*) filter (where o.confirmed_at >= ${at(start)}))::int as orders,
           coalesce(sum(o.total) filter (where o.confirmed_at < ${at(start)}), 0)::text as prev_revenue
      from public.orders o
     where ${counted} and o.confirmed_at >= ${at(prevStart)} and o.confirmed_at < ${at(end)}`);

  const weekly = range === "year";
  const bucketSql = weekly
    ? sql`date_trunc('week', o.confirmed_at at time zone ${tz})::date`
    : sql`(o.confirmed_at at time zone ${tz})::date`;
  const found = await rows<{ d: string; v: string }>(sql`
    select to_char(${bucketSql}, 'YYYY-MM-DD') as d, sum(o.total)::text as v
      from public.orders o where ${counted} and ${inPeriod} group by 1`);
  const byDate = new Map(found.map((r) => [r.d, r.v]));
  const series: Metrics["series"] = [];
  for (let d = weekly ? mondayOf(start) : start; d < end; d = addDays(d, weekly ? 7 : 1)) {
    series.push({ date: d, value: byDate.get(d) ?? "0" });
  }

  const [topProducts, byCategory, low, lowItems] = await Promise.all([
    rows<{ name: string; revenue: string }>(sql`
      select p.name, sum(i.line_total)::text as revenue
        from public.orders o
        join public.order_items i on i.order_id = o.id
        join public.products p on p.id = i.product_id
       where ${counted} and ${inPeriod}
       group by p.id, p.name order by sum(i.line_total) desc, p.name limit 5`),
    rows<{ name: string; revenue: string }>(sql`
      select coalesce(c.name, 'Sin categoría') as name, sum(i.line_total)::text as revenue
        from public.orders o
        join public.order_items i on i.order_id = o.id
        join public.products p on p.id = i.product_id
        left join public.categories c on c.id = p.category_id and c.org_id = p.org_id
       where ${counted} and ${inPeriod}
       group by c.id, c.name order by sum(i.line_total) desc, 1`),
    rows<{ n: number }>(sql`select count(*)::int as n from public.products where org_id = ${orgId} and active and stock_qty <= reorder_level`),
    rows<{ id: string; name: string; stock_qty: number; reorder_level: number }>(sql`
      select id, name, stock_qty, reorder_level from public.products
       where org_id = ${orgId} and active and stock_qty <= reorder_level
       order by stock_qty, name limit 5`),
  ]);

  const [change] = await rows<{ pct: string | null; avg: string | null }>(sql`
    select case when ${totals.prev_revenue}::numeric = 0 then null
                else round((${totals.revenue}::numeric - ${totals.prev_revenue}::numeric) / ${totals.prev_revenue}::numeric * 100, 1)::text end as pct,
           case when ${totals.orders}::int = 0 then null
                else round(${totals.revenue}::numeric / ${totals.orders}::int, 2)::text end as avg`);

  return {
    from: start,
    to: today,
    revenue: totals.revenue,
    revenueChangePct: change.pct,
    orders: totals.orders,
    avgTicket: change.avg,
    series,
    bucket: weekly ? "week" : "day",
    topProducts,
    byCategory,
    lowStock: { count: low[0].n, items: lowItems.map((r) => ({ id: r.id, name: r.name, stockQty: r.stock_qty, reorderLevel: r.reorder_level })) },
  };
}
