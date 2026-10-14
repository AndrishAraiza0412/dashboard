import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAsUser } from "@/server/db/rls";
import { getMetrics, parseRange, type RangeInput } from "@/server/metrics";
import { addMember, admin, cleanup, closeAll, createOrg, createUser, emailOf, runtime } from "./helpers";

// AC16-AC17: KPIs against a small hand-computed fixture, `now` pinned, org time zone America/Mexico_City (UTC-6).
// now = 2026-03-15 12:00 local. Orders (local day -> amount):
//   03-14 23:30  20 (A x2)   <- 05:30Z on 03-15: must stay on 03-14, not slide to the next UTC day
//   03-15        30 (B)      fulfilled
//   03-10        40 (A + B)
//   02-20        40 (A x4)
//   02-01        30 (B)      previous period for 30d
//   plus a cancelled and a draft order that must not count.
const NOW = new Date("2026-03-15T18:00:00Z");
let org: string, empty: string, user: string;
const db = drizzle(runtime);
const run = (orgId: string, range: RangeInput) =>
  runAsUser(db, { sub: user, role: "authenticated", email: emailOf(user) }, (tx) => getMetrics(tx, { orgId, timezone: "America/Mexico_City" }, range, NOW));

async function order(status: string, confirmedAt: string | null, lines: [string, number, string][]) {
  // created_at: the confirmation time, or a fixed day for orders that were never confirmed
  const [{ id }] = await admin`insert into orders (org_id, status, confirmed_at, created_at) values (${org}, ${status}, ${confirmedAt}, ${confirmedAt ?? "2026-03-12T12:00:00Z"}) returning id`;
  for (const [product, qty, price] of lines) {
    await admin`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${org}, ${id}, ${product}, ${qty}, ${price})`;
  }
}

beforeAll(async () => {
  user = await createUser();
  [org, empty] = [await createOrg(), await createOrg()];
  for (const o of [org, empty]) {
    await addMember(o, user, "admin");
    await admin`update organizations set timezone = 'America/Mexico_City' where id = ${o}`;
  }
  const [{ id: cat }] = await admin`insert into categories (org_id, name) values (${org}, 'Cat1') returning id`;
  const [{ id: a }] = await admin`insert into products (org_id, sku, name, price, cost, stock_qty, reorder_level, category_id) values (${org}, 'a', 'Alfa', 10, 4, 2, 5, ${cat}) returning id`;
  const [{ id: b }] = await admin`insert into products (org_id, sku, name, price, cost, stock_qty, reorder_level) values (${org}, 'b', 'Beta', 30, 12, 10, 5) returning id`;
  await admin`insert into products (org_id, sku, name, stock_qty, reorder_level, active) values (${org}, 'c', 'Gamma', 0, 5, false)`;
  await order("confirmed", "2026-03-15T05:30:00Z", [[a, 2, "10"]]);
  await order("fulfilled", "2026-03-15T15:00:00Z", [[b, 1, "30"]]);
  await order("confirmed", "2026-03-10T18:00:00Z", [[a, 1, "10"], [b, 1, "30"]]);
  await order("confirmed", "2026-02-20T18:00:00Z", [[a, 4, "10"]]);
  await order("confirmed", "2026-02-01T18:00:00Z", [[b, 1, "30"]]);
  await order("cancelled", "2026-03-14T18:00:00Z", [[a, 100, "10"]]);
  await order("draft", null, [[a, 100, "10"]]);
});

afterAll(async () => {
  await cleanup();
  await closeAll();
});

describe("AC16 KPIs", () => {
  it("7d: totals, no previous period, 23:30 local order stays on its day", async () => {
    const m = await run(org, "7d");
    expect(m).toMatchObject({ from: "2026-03-09", to: "2026-03-15", revenue: "90.00", orders: 3, avgTicket: "30.00", revenueChangePct: null, bucket: "day" });
    expect(m.series).toHaveLength(7);
    expect(Object.fromEntries(m.series.map((p) => [p.date, p.value]))).toEqual({
      "2026-03-09": "0", "2026-03-10": "40.00", "2026-03-11": "0", "2026-03-12": "0", "2026-03-13": "0", "2026-03-14": "20.00", "2026-03-15": "30.00",
    });
  });

  it("30d: change against the previous 30 days, top products, categories, low stock", async () => {
    const m = await run(org, "30d");
    expect(m).toMatchObject({ revenue: "130.00", orders: 4, avgTicket: "32.50", revenueChangePct: "333.3" });
    expect(m.series).toHaveLength(30);
    expect(m.topProducts).toEqual([{ name: "Alfa", revenue: "70.00" }, { name: "Beta", revenue: "60.00" }]);
    expect(m.byCategory).toEqual([{ name: "Cat1", revenue: "70.00" }, { name: "Sin categoría", revenue: "60.00" }]);
    expect(m.lowStock.count).toBe(1);
    expect(m.lowStock.items.map((i) => i.name)).toEqual(["Alfa"]);
  });

  it("year: ISO weeks starting on Monday", async () => {
    const m = await run(org, "year");
    expect(m).toMatchObject({ from: "2026-01-01", revenue: "160.00", orders: 5, bucket: "week" });
    expect(m.series).toHaveLength(11);
    expect(m.series[0].date).toBe("2025-12-29");
    const by = Object.fromEntries(m.series.map((p) => [p.date, p.value]));
    expect(by).toMatchObject({ "2026-01-26": "30.00", "2026-02-16": "40.00", "2026-03-09": "90.00" });
  });
});

describe("richer KPIs", () => {
  it("30d: change in orders and ticket, margin, status counts, customers, inventory value, previous series", async () => {
    const m = await run(org, "30d");
    expect(m).toMatchObject({ ordersChangePct: "300.0", avgTicketChangePct: "8.3", customersServed: 0, margin: "78.00", marginPct: "60.0" });
    expect(m.ordersByStatus).toEqual([
      { status: "draft", count: 1 }, { status: "confirmed", count: 3 }, { status: "fulfilled", count: 1 }, { status: "cancelled", count: 1 },
    ]);
    expect(m.topCustomers).toEqual([{ name: "Sin cliente", revenue: "130.00" }]);
    expect(m.inventory).toEqual({ stockValue: "128.00", active: 2, outOfStock: 0 });
    expect(m.previousSeries).toHaveLength(30);
    expect(m.previousSeries[17]).toEqual({ date: "2026-03-03", value: "30.00" }); // the 02-01 order, one period earlier
    expect(m.recentOrders).toHaveLength(5);
  });

  it("7d: revenue by ISO weekday in the org time zone (Monday = 1)", async () => {
    const m = await run(org, "7d");
    expect(m.byWeekday.map((d) => [d.day, d.revenue, d.orders])).toEqual([
      [1, "0", 0], [2, "40.00", 1], [3, "0", 0], [4, "0", 0], [5, "0", 0], [6, "20.00", 1], [7, "30.00", 1],
    ]);
    expect(m.previousSeries.every((p) => p.value === "0")).toBe(true);
  });

  it("custom range: exact days, clamped to today, never longer than a year", async () => {
    const m = await run(org, parseRange("custom", "2026-03-10", "2026-03-14"));
    expect(m).toMatchObject({ from: "2026-03-10", to: "2026-03-14", custom: true, revenue: "60.00", orders: 2 });
    expect(m.series).toHaveLength(5);
    expect((await run(org, { from: "2026-03-10", to: "2026-12-31" })).to).toBe("2026-03-15");
    expect((await run(org, { from: "2000-01-01", to: "2026-03-15" })).series.length).toBeLessThanOrEqual(60); // weekly buckets
  });

  it("parseRange only accepts well-formed input", () => {
    expect(parseRange("custom", "2026-03-10", "2026-03-14")).toEqual({ from: "2026-03-10", to: "2026-03-14" });
    expect(parseRange("custom", "oops", "2026-03-14")).toBe("30d");
    expect(parseRange("custom", "2026-13-45", "2026-03-14")).toBe("30d");
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("nope")).toBe("30d");
  });
});

describe("AC17 empty period", () => {
  it("shows no ticket or change and does not fail", async () => {
    const m = await run(empty, "30d");
    expect(m).toMatchObject({ revenue: "0", orders: 0, avgTicket: null, revenueChangePct: null, topProducts: [], byCategory: [] });
    expect(m.series.every((p) => p.value === "0")).toBe(true);
  });
});
