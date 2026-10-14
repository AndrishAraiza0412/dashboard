import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAsUser } from "@/server/db/rls";
import { listActivity } from "@/server/activity";
import { listProducts } from "@/server/inventory";
import { listCustomers, listOrders } from "@/server/sales";
import { addMember, admin, cleanup, closeAll, createOrg, createUser, emailOf, runtime } from "./helpers";

// List options added with the richer admin views: sorting, filters, paging, search escaping, local-day date filters.
const TZ = "America/Mexico_City";
let org: string, adminUser: string, viewer: string, c1: string, c2: string;
const db = drizzle(runtime);
const as = <T>(user: string, fn: Parameters<typeof runAsUser<T>>[2]) => runAsUser(db, { sub: user, role: "authenticated", email: emailOf(user) }, fn);
const products = (f: Partial<Parameters<typeof listProducts>[2]> = {}) => as(adminUser, (tx) => listProducts(tx, org, { page: 1, size: 20, ...f }));
const names = (r: { rows: { name: string }[] }) => r.rows.map((p) => p.name);

async function order(customer: string, createdAt: string, price: string, qty = 1) {
  const [{ id }] = await admin`insert into orders (org_id, customer_id, created_at) values (${org}, ${customer}, ${createdAt}) returning id`;
  const [{ id: product }] = await admin`select id from products where org_id = ${org} limit 1`;
  await admin`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${org}, ${id}, ${product}, ${qty}, ${price})`;
  return id as string;
}

beforeAll(async () => {
  [adminUser, viewer] = await Promise.all([createUser(), createUser()]);
  org = await createOrg();
  await addMember(org, adminUser, "admin");
  await addMember(org, viewer, "viewer");
  // created one after another, so "newest" has a defined order
  await admin`insert into products (org_id, sku, name, price, stock_qty, reorder_level, active) values (${org}, 'a', 'Alfa', 30, 5, 5, true)`;
  await admin`insert into products (org_id, sku, name, price, stock_qty, reorder_level, active) values (${org}, 'b', 'beta_x', 10, 50, 5, true)`;
  await admin`insert into products (org_id, sku, name, price, stock_qty, reorder_level, active) values (${org}, 'c', 'Gamma', 20, 0, 5, false)`;
  [{ id: c1 }] = await admin`insert into customers (org_id, name, email) values (${org}, 'Ana', 'ana@ejemplo.com') returning id`;
  [{ id: c2 }] = await admin`insert into customers (org_id, name, active) values (${org}, 'Beto', false) returning id`;
});

afterAll(async () => {
  await cleanup();
  await closeAll();
});

describe("products", () => {
  it("sorts by name, price, stock and recency", async () => {
    expect(names(await products({ sort: "name_asc" }))).toEqual(["Alfa", "beta_x", "Gamma"]);
    expect(names(await products({ sort: "name_desc" }))).toEqual(["Gamma", "beta_x", "Alfa"]);
    expect(names(await products({ sort: "price_asc" }))).toEqual(["beta_x", "Gamma", "Alfa"]);
    expect(names(await products({ sort: "price_desc" }))).toEqual(["Alfa", "Gamma", "beta_x"]);
    expect(names(await products({ sort: "stock_desc" }))).toEqual(["beta_x", "Alfa", "Gamma"]);
    expect(names(await products({ sort: "stock_asc" }))).toEqual(["Gamma", "Alfa", "beta_x"]);
    expect(names(await products({ sort: "newest" }))).toEqual(["Gamma", "beta_x", "Alfa"]);
  });

  it("filters by status and stock level", async () => {
    expect(names(await products({ status: "active" })).sort()).toEqual(["Alfa", "beta_x"]);
    expect(names(await products({ status: "inactive" }))).toEqual(["Gamma"]);
    expect(names(await products({ stock: "out" }))).toEqual(["Gamma"]);
    expect(names(await products({ stock: "low" }))).toEqual(["Alfa"]); // active and stock <= reorder level
  });

  it("searches literally: % and _ are not wildcards", async () => {
    expect(names(await products({ q: "_" }))).toEqual(["beta_x"]);
    expect((await products({ q: "%" })).total).toBe(0);
    expect(names(await products({ q: "ALF" }))).toEqual(["Alfa"]);
  });

  it("pages with the requested size", async () => {
    const p2 = await products({ size: 2, page: 2 });
    expect(p2.total).toBe(3);
    expect(p2.rows).toHaveLength(1);
    const past = await products({ size: 2, page: 9 }); // beyond the last page: no rows, but the total is still right
    expect(past).toMatchObject({ total: 3, rows: [] });
  });
});

describe("orders", () => {
  let o1: string, o2: string, o3: string;
  beforeAll(async () => {
    o1 = await order(c1, "2026-03-10T18:00:00Z", "100"); // local 03-10 12:00
    o2 = await order(c2, "2026-03-11T18:00:00Z", "50"); // local 03-11 12:00
    o3 = await order(c1, "2026-03-12T05:30:00Z", "70"); // local 03-11 23:30: UTC says the 12th, the org says the 11th
  });
  const orders = (f: Partial<Parameters<typeof listOrders>[2]> = {}) => as(adminUser, (tx) => listOrders(tx, org, { timezone: TZ, page: 1, size: 20, ...f }));
  const ids = (r: { rows: { id: string }[] }) => r.rows.map((o) => o.id);

  it("sorts by date and total", async () => {
    expect(ids(await orders({ sort: "date_desc" }))).toEqual([o3, o2, o1]);
    expect(ids(await orders({ sort: "date_asc" }))).toEqual([o1, o2, o3]);
    expect(ids(await orders({ sort: "total_desc" }))).toEqual([o1, o3, o2]);
    expect(ids(await orders({ sort: "total_asc" }))).toEqual([o2, o3, o1]);
  });

  it("filters by customer, status and local-day range (in the organization's time zone)", async () => {
    expect(ids(await orders({ customerId: c1, sort: "date_asc" }))).toEqual([o1, o3]);
    expect((await orders({ status: "confirmed" })).total).toBe(0); // all three are drafts
    expect((await orders({ status: "draft" })).total).toBe(3);
    expect(ids(await orders({ from: "2026-03-11", to: "2026-03-11", sort: "date_asc" }))).toEqual([o2, o3]); // 23:30 local stays on the 11th
    expect(ids(await orders({ to: "2026-03-10" }))).toEqual([o1]);
    expect(ids(await orders({ from: "2026-03-12" }))).toEqual([]);
  });

  it("another organization's customer id finds nothing", async () => {
    expect((await orders({ customerId: "00000000-0000-0000-0000-000000000000" })).total).toBe(0);
  });
});

describe("customers", () => {
  const customers = (f: Parameters<typeof listCustomers>[2]) => as(adminUser, (tx) => listCustomers(tx, org, f));
  it("searches by name, e-mail or phone and filters by status", async () => {
    expect((await customers({ q: "ana" })).map((c) => c.name)).toEqual(["Ana"]);
    expect((await customers({ q: "ejemplo.com" })).map((c) => c.name)).toEqual(["Ana"]);
    expect((await customers({ q: "%" })).length).toBe(0);
    expect((await customers({ status: "inactive" })).map((c) => c.name)).toEqual(["Beto"]);
    expect((await customers({ status: "active" })).map((c) => c.name)).toEqual(["Ana"]);
    expect((await customers({})).length).toBe(2);
  });
});

describe("activity (audit trail)", () => {
  it("admins see the organization's changes, filtered and paged; viewers see none", async () => {
    const all = await as(adminUser, (tx) => listActivity(tx, org, { page: 1, size: 100 }));
    expect(all.total).toBeGreaterThanOrEqual(3);
    const onlyProducts = await as(adminUser, (tx) => listActivity(tx, org, { entity: "products", action: "insert", page: 1, size: 2 }));
    expect(onlyProducts.total).toBe(3);
    expect(onlyProducts.rows).toHaveLength(2);
    expect(onlyProducts.rows.every((r) => r.entity === "products" && r.action === "insert")).toBe(true);
    const asViewer = await as(viewer, (tx) => listActivity(tx, org, { page: 1, size: 100 }));
    expect(asViewer.total).toBe(0);
    expect(asViewer.rows).toEqual([]);
  });
});
