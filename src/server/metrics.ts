import { sql } from "drizzle-orm";
import type { Tx } from "@/server/db/rls";

export const RANGES = { "7d": 7, "30d": 30, "90d": 90, year: 0 } as const;
export type Range = keyof typeof RANGES;
export type RangeInput = Range | { from: string; to: string };
export const MAX_SPAN_DAYS = 366;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** `?range=` preset, or `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`; anything else falls back to 30 days. */
export function parseRange(range: string | undefined, from?: string, to?: string): RangeInput {
  if (range === "custom" && from && to && ISO_DAY.test(from) && ISO_DAY.test(to) && !Number.isNaN(Date.parse(`${from}T00:00:00Z`)) && !Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    return { from, to };
  }
  return range && range in RANGES ? (range as Range) : "30d";
}

export type Metrics = {
  from: string; // first local day of the period (YYYY-MM-DD)
  to: string; // last local day of the period
  custom: boolean;
  revenue: string;
  revenueChangePct: string | null; // null when the previous period had no revenue
  orders: number;
  ordersChangePct: string | null;
  avgTicket: string | null; // null with 0 orders
  avgTicketChangePct: string | null;
  customersServed: number;
  margin: string; // estimated: sale price minus the product's current cost
  marginPct: string | null;
  series: { date: string; value: string }[]; // day buckets, or ISO weeks (Monday) for long periods
  previousSeries: { date: string; value: string }[]; // same length, shifted back one period
  bucket: "day" | "week";
  topProducts: { name: string; revenue: string }[];
  byCategory: { name: string; revenue: string }[];
  topCustomers: { name: string; revenue: string }[];
  byWeekday: { day: number; revenue: string; orders: number }[]; // ISO day 1 = Monday .. 7 = Sunday
  ordersByStatus: { status: "draft" | "confirmed" | "fulfilled" | "cancelled"; count: number }[];
  recentOrders: { id: string; number: number | null; status: string; total: string; createdAt: string; customer: string | null }[];
  inventory: { stockValue: string; active: number; outOfStock: number };
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
 * Confirmed + fulfilled orders by `confirmed_at`, bucketed in the organization's time zone. Periods are whole local
 * days; the previous period has the same length and ends where this one starts. `now` is a parameter so tests can
 * pin the date. Money stays a string (numeric) until display. Every query is independent, so they are all sent
 * together on the same transaction (pipelined: one wait instead of one per query).
 */
export async function getMetrics(tx: Tx, org: { orgId: string; timezone: string }, range: RangeInput, now = new Date()): Promise<Metrics> {
  const { orgId, timezone: tz } = org;
  const today = localDay(now, tz);
  let start: string;
  let last: string; // inclusive
  if (typeof range === "object") {
    last = range.to > today ? today : range.to;
    start = range.from > last ? last : range.from;
    if ((parse(last) - parse(start)) / DAY + 1 > MAX_SPAN_DAYS) start = addDays(last, 1 - MAX_SPAN_DAYS);
  } else {
    last = today;
    start = range === "year" ? `${today.slice(0, 4)}-01-01` : addDays(today, 1 - RANGES[range]);
  }
  const end = addDays(last, 1); // exclusive
  const len = (parse(end) - parse(start)) / DAY;
  const prevStart = addDays(start, -len);
  const weekly = range === "year" || len > 120;

  // local midnight of a YYYY-MM-DD as timestamptz
  const at = (d: string) => sql`(${d}::date)::timestamp at time zone ${tz}`;
  const counted = sql`o.org_id = ${orgId} and o.status in ('confirmed', 'fulfilled')`;
  const within = (a: string, b: string) => sql`o.confirmed_at >= ${at(a)} and o.confirmed_at < ${at(b)}`;
  const bucketSql = weekly ? sql`date_trunc('week', o.confirmed_at at time zone ${tz})::date` : sql`(o.confirmed_at at time zone ${tz})::date`;
  const seriesQuery = (a: string, b: string) => sql`
    select to_char(${bucketSql}, 'YYYY-MM-DD') as d, sum(o.total)::text as v
      from public.orders o where ${counted} and ${within(a, b)} group by 1`;

  // ONE statement for the whole dashboard. Inside the connection pooler every parameterized statement costs two
  // round trips (the driver asks for parameter types first) and statements on a transaction run one after another,
  // so twelve queries took ~1.7 s of waiting. As JSON sub-selects they cost a single trip.
  const one = (q: ReturnType<typeof sql>) => sql`(select to_jsonb(x) from (${q}) x)`;
  const list = (q: ReturnType<typeof sql>) => sql`coalesce((select jsonb_agg(to_jsonb(x)) from (${q}) x), '[]'::jsonb)`;
  const [{ d: data }] = (await tx.execute(sql`
    select jsonb_build_object(
      'totals', ${one(sql`
        with cur as (
          select coalesce(sum(o.total), 0) as rev, count(*) as n, count(distinct o.customer_id) as c
            from public.orders o where ${counted} and ${within(start, end)}),
        prev as (
          select coalesce(sum(o.total), 0) as rev, count(*) as n
            from public.orders o where ${counted} and ${within(prevStart, start)})
        select cur.rev::text as revenue, cur.n::int as orders, cur.c::int as customers,
               case when prev.rev = 0 then null else round((cur.rev - prev.rev) / prev.rev * 100, 1)::text end as revenue_pct,
               case when prev.n = 0 then null else round((cur.n - prev.n)::numeric / prev.n * 100, 1)::text end as orders_pct,
               case when cur.n = 0 then null else round(cur.rev / cur.n, 2)::text end as avg,
               case when cur.n = 0 or prev.n = 0 or prev.rev = 0 then null
                    else round(((cur.rev / cur.n) - (prev.rev / prev.n)) / (prev.rev / prev.n) * 100, 1)::text end as avg_pct
          from cur, prev`)},
      'found', ${list(seriesQuery(start, end))},
      'foundPrev', ${list(seriesQuery(prevStart, start))},
      'topProducts', ${list(sql`
        select p.name, sum(i.line_total)::text as revenue
          from public.orders o
          join public.order_items i on i.order_id = o.id
          join public.products p on p.id = i.product_id
         where ${counted} and ${within(start, end)}
         group by p.id, p.name order by sum(i.line_total) desc, p.name limit 5`)},
      'byCategory', ${list(sql`
        select coalesce(c.name, 'Sin categoría') as name, sum(i.line_total)::text as revenue
          from public.orders o
          join public.order_items i on i.order_id = o.id
          join public.products p on p.id = i.product_id
          left join public.categories c on c.id = p.category_id and c.org_id = p.org_id
         where ${counted} and ${within(start, end)}
         group by c.id, c.name order by sum(i.line_total) desc, 1`)},
      'topCustomers', ${list(sql`
        select coalesce(cu.name, 'Sin cliente') as name, sum(o.total)::text as revenue
          from public.orders o
          left join public.customers cu on cu.id = o.customer_id and cu.org_id = o.org_id
         where ${counted} and ${within(start, end)}
         group by cu.id, cu.name order by sum(o.total) desc, 1 limit 5`)},
      'weekdays', ${list(sql`
        select extract(isodow from o.confirmed_at at time zone ${tz})::int as day, sum(o.total)::text as revenue, count(*)::int as orders
          from public.orders o where ${counted} and ${within(start, end)} group by 1`)},
      'statuses', ${list(sql`
        select o.status::text as status, count(*)::int as count
          from public.orders o
         where o.org_id = ${orgId} and o.created_at >= ${at(start)} and o.created_at < ${at(end)} group by 1`)},
      'recent', ${list(sql`
        select o.id, o.number, o.status::text as status, o.total::text as total, o.created_at, cu.name as customer
          from public.orders o
          left join public.customers cu on cu.id = o.customer_id and cu.org_id = o.org_id
         where o.org_id = ${orgId} order by o.created_at desc, o.id limit 5`)},
      'margin', ${one(sql`
        select coalesce(sum(i.qty * (i.unit_price - p.cost)), 0)::text as margin
          from public.orders o
          join public.order_items i on i.order_id = o.id
          join public.products p on p.id = i.product_id
         where ${counted} and ${within(start, end)}`)},
      'stock', ${one(sql`
        select coalesce(sum(stock_qty * cost), 0)::text as stock_value,
               (count(*) filter (where active))::int as active,
               (count(*) filter (where active and stock_qty = 0))::int as out_of_stock,
               (count(*) filter (where active and stock_qty <= reorder_level))::int as low
          from public.products where org_id = ${orgId}`)},
      'lowItems', ${list(sql`
        select id, name, stock_qty, reorder_level from public.products
         where org_id = ${orgId} and active and stock_qty <= reorder_level
         order by stock_qty, name limit 5`)}
    ) as d`)) as unknown as { d: Raw }[];

  type Series = { d: string; v: string }[];
  type Raw = {
    totals: { revenue: string; orders: number; customers: number; revenue_pct: string | null; orders_pct: string | null; avg: string | null; avg_pct: string | null };
    found: Series;
    foundPrev: Series;
    topProducts: { name: string; revenue: string }[];
    byCategory: { name: string; revenue: string }[];
    topCustomers: { name: string; revenue: string }[];
    weekdays: { day: number; revenue: string; orders: number }[];
    statuses: { status: Metrics["ordersByStatus"][number]["status"]; count: number }[];
    recent: { id: string; number: number | null; status: string; total: string; created_at: string; customer: string | null }[];
    margin: { margin: string };
    stock: { stock_value: string; active: number; out_of_stock: number; low: number };
    lowItems: { id: string; name: string; stock_qty: number; reorder_level: number }[];
  };
  const { totals: t, found, foundPrev, topProducts, byCategory, topCustomers, weekdays, statuses, recent, margin: mr, stock: sk, lowItems } = data;

  const dates: string[] = [];
  for (let d = weekly ? mondayOf(start) : start; d < end; d = addDays(d, weekly ? 7 : 1)) dates.push(d);
  const fill = (m: Map<string, string>, shift: number) => dates.map((d) => ({ date: d, value: m.get(shift ? addDays(d, -shift) : d) ?? "0" }));
  const cur = new Map(found.map((r) => [r.d, r.v]));
  const prev = new Map(foundPrev.map((r) => [r.d, r.v]));
  // the previous period starts `len` days earlier; weekly buckets stay Monday-aligned by shifting whole weeks
  const shiftDays = weekly ? Math.round(len / 7) * 7 : len;

  const revenueNum = Number(t.revenue);
  const byDay = new Map(weekdays.map((r) => [r.day, r]));

  return {
    from: start,
    to: last,
    custom: typeof range === "object",
    revenue: t.revenue,
    revenueChangePct: t.revenue_pct,
    orders: t.orders,
    ordersChangePct: t.orders_pct,
    avgTicket: t.avg,
    avgTicketChangePct: t.avg_pct,
    customersServed: t.customers,
    margin: mr.margin,
    marginPct: revenueNum > 0 ? (Math.round((Number(mr.margin) / revenueNum) * 1000) / 10).toFixed(1) : null,
    series: fill(cur, 0),
    previousSeries: fill(prev, shiftDays),
    bucket: weekly ? "week" : "day",
    topProducts,
    byCategory,
    topCustomers,
    byWeekday: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, revenue: byDay.get(day)?.revenue ?? "0", orders: byDay.get(day)?.orders ?? 0 })),
    ordersByStatus: (["draft", "confirmed", "fulfilled", "cancelled"] as const).map((status) => ({ status, count: statuses.find((r) => r.status === status)?.count ?? 0 })),
    recentOrders: recent.map((r) => ({ id: r.id, number: r.number, status: r.status, total: r.total, createdAt: new Date(r.created_at).toISOString(), customer: r.customer })),
    inventory: { stockValue: sk.stock_value, active: sk.active, outOfStock: sk.out_of_stock },
    lowStock: { count: sk.low, items: lowItems.map((r) => ({ id: r.id, name: r.name, stockQty: r.stock_qty, reorderLevel: r.reorder_level })) },
  };
}
