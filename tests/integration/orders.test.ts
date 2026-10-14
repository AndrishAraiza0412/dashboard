import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember, admin, asUser, cleanup, closeAll, createCustomer, createDraftOrder, createOrg, createProduct,
  createUser, stockOf,
} from "./helpers";

// AC8-AC12: stock integrity, order lifecycle, concurrency, audit.
let org: string, member: string, viewer: string, adminUser: string, customer: string;

beforeAll(async () => {
  [member, viewer, adminUser] = await Promise.all([createUser(), createUser(), createUser()]);
  org = await createOrg();
  await addMember(org, member, "member");
  await addMember(org, viewer, "viewer");
  await addMember(org, adminUser, "admin");
  customer = await createCustomer(org);
});

afterAll(async () => {
  await cleanup();
  await closeAll();
});

const confirm = (user: string, order: string, requestId?: string) =>
  asUser(user, (tx) => tx`select public.confirm_order(${order}) as n`, { requestId });
const movements = (order: string) =>
  admin`select product_id, delta, reason from stock_movements where order_id = ${order} order by reason, delta`;

describe("AC11 totals are derived from the lines", () => {
  it("tracks insert, update and delete of lines", async () => {
    const p1 = await createProduct(org, { stock: 50 });
    const p2 = await createProduct(org, { stock: 50 });
    const [{ id: order }] = await asUser(member, (tx) => tx`insert into orders (org_id, customer_id) values (${org}, ${customer}) returning id`);
    const total = async () => (await admin`select total::text as t from orders where id = ${order}`)[0].t;

    expect(await total()).toBe("0.00");
    const [{ id: l1 }] = await asUser(member, (tx) =>
      tx`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${org}, ${order}, ${p1}, 3, 12.50) returning id`);
    expect(await total()).toBe("37.50");
    await asUser(member, (tx) =>
      tx`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${org}, ${order}, ${p2}, 2, 0.10)`);
    expect(await total()).toBe("37.70");
    await asUser(member, (tx) => tx`update order_items set qty = 4 where id = ${l1}`);
    expect(await total()).toBe("50.20");
    await asUser(member, (tx) => tx`delete from order_items where id = ${l1}`);
    expect(await total()).toBe("0.20");
  });
});

describe("AC8 confirming an order", () => {
  it("fails atomically when stock is insufficient", async () => {
    const enough = await createProduct(org, { stock: 5 });
    const scarce = await createProduct(org, { stock: 1 });
    const order = await createDraftOrder(org, [{ productId: enough, qty: 2 }, { productId: scarce, qty: 2 }]);

    await expect(confirm(member, order)).rejects.toThrow(/insufficient stock/);

    expect(await stockOf(enough)).toBe(5);
    expect(await stockOf(scarce)).toBe(1);
    expect((await movements(order)).length).toBe(0);
    const [o] = await admin`select status, number from orders where id = ${order}`;
    expect(o).toMatchObject({ status: "draft", number: null });
  });

  it("decrements stock exactly, writes one movement per line and numbers orders sequentially", async () => {
    const a = await createProduct(org, { stock: 10 });
    const b = await createProduct(org, { stock: 4 });
    const first = await createDraftOrder(org, [{ productId: a, qty: 3 }, { productId: b, qty: 4 }]);
    const second = await createDraftOrder(org, [{ productId: a, qty: 1 }]);

    const [{ n: n1 }] = await confirm(member, first);
    const [{ n: n2 }] = await confirm(member, second);

    expect(n2).toBe(n1 + 1);
    expect(await stockOf(a)).toBe(10 - 3 - 1);
    expect(await stockOf(b)).toBe(0);
    const moved = await movements(first);
    expect(moved.map((m) => m.delta).sort((x, y) => x - y)).toEqual([-4, -3]);
    expect(moved.every((m) => m.reason === "sale")).toBe(true);
    const [o] = await admin`select status, number, confirmed_at from orders where id = ${first}`;
    expect(o.status).toBe("confirmed");
    expect(o.number).toBe(n1);
    expect(o.confirmed_at).not.toBeNull();
  });

  it("rejects orders with no lines, and re-confirming", async () => {
    const [{ id: empty }] = await admin`insert into orders (org_id) values (${org}) returning id`;
    await expect(confirm(member, empty)).rejects.toThrow(/no items/);
    const p = await createProduct(org, { stock: 5 });
    const order = await createDraftOrder(org, [{ productId: p, qty: 1 }]);
    await confirm(member, order);
    await expect(confirm(member, order)).rejects.toThrow(/not a draft/);
    expect(await stockOf(p)).toBe(4);
  });
});

describe("AC9 concurrency", () => {
  it("two confirmations of the same order: exactly one succeeds", async () => {
    const p = await createProduct(org, { stock: 10 });
    const order = await createDraftOrder(org, [{ productId: p, qty: 3 }]);
    const results = await Promise.allSettled([confirm(member, order), confirm(adminUser, order)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await stockOf(p)).toBe(7);
    expect((await movements(order)).length).toBe(1);
  });

  it("two orders for the last unit: exactly one succeeds and stock never goes negative", async () => {
    const p = await createProduct(org, { stock: 1 });
    const o1 = await createDraftOrder(org, [{ productId: p, qty: 1 }]);
    const o2 = await createDraftOrder(org, [{ productId: p, qty: 1 }]);
    const results = await Promise.allSettled([confirm(member, o1), confirm(adminUser, o2)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await stockOf(p)).toBe(0);
  });

  it("concurrent confirmations get distinct order numbers", async () => {
    const p = await createProduct(org, { stock: 100 });
    const orders = await Promise.all(Array.from({ length: 4 }, () => createDraftOrder(org, [{ productId: p, qty: 1 }])));
    const results = await Promise.all(orders.map((o) => confirm(member, o)));
    const numbers = results.map((r) => r[0].n);
    expect(new Set(numbers).size).toBe(4);
  });
});

describe("AC10 cancelling and fulfilling", () => {
  it("cancelling a confirmed order restores stock exactly", async () => {
    const a = await createProduct(org, { stock: 6 });
    const b = await createProduct(org, { stock: 2 });
    const order = await createDraftOrder(org, [{ productId: a, qty: 5 }, { productId: b, qty: 2 }]);
    await confirm(member, order);
    expect([await stockOf(a), await stockOf(b)]).toEqual([1, 0]);

    await asUser(member, (tx) => tx`select public.cancel_order(${order})`);
    expect([await stockOf(a), await stockOf(b)]).toEqual([6, 2]);
    const back = await admin`select reason, delta from stock_movements where order_id = ${order} and reason = 'sale_cancel'`;
    expect(back.map((m) => m.delta).sort()).toEqual([2, 5]);
    await expect(asUser(member, (tx) => tx`select public.cancel_order(${order})`)).rejects.toThrow(/cannot be cancelled/);
  });

  it("a draft can be cancelled without touching stock; a fulfilled order cannot be cancelled", async () => {
    const p = await createProduct(org, { stock: 3 });
    const draft = await createDraftOrder(org, [{ productId: p, qty: 1 }]);
    await asUser(member, (tx) => tx`select public.cancel_order(${draft})`);
    expect(await stockOf(p)).toBe(3);

    const done = await createDraftOrder(org, [{ productId: p, qty: 1 }]);
    await confirm(member, done);
    await asUser(member, (tx) => tx`select public.fulfill_order(${done})`);
    await expect(asUser(member, (tx) => tx`select public.cancel_order(${done})`)).rejects.toThrow(/cannot be cancelled/);
    expect(await stockOf(p)).toBe(2);
  });

  it("only confirmed orders can be fulfilled", async () => {
    const p = await createProduct(org, { stock: 3 });
    const draft = await createDraftOrder(org, [{ productId: p, qty: 1 }]);
    await expect(asUser(member, (tx) => tx`select public.fulfill_order(${draft})`)).rejects.toThrow(/only confirmed/);
  });
});

describe("orders are immutable after confirmation", () => {
  it("lines and notes cannot be changed once confirmed", async () => {
    const p = await createProduct(org, { stock: 9 });
    const order = await createDraftOrder(org, [{ productId: p, qty: 2 }]);
    await confirm(member, order);

    const upd = await asUser(member, (tx) => tx`update order_items set qty = 1 where order_id = ${order}`);
    expect(upd.count).toBe(0);
    const del = await asUser(member, (tx) => tx`delete from order_items where order_id = ${order}`);
    expect(del.count).toBe(0);
    const note = await asUser(member, (tx) => tx`update orders set notes = 'x' where id = ${order}`);
    expect(note.count).toBe(0);
    await expect(
      asUser(member, (tx) => tx`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${org}, ${order}, ${p}, 1, 1)`),
    ).rejects.toThrow(/row-level security/);
    const [{ q }] = await admin`select qty as q from order_items where order_id = ${order}`;
    expect(q).toBe(2);
  });
});

describe("adjust_stock", () => {
  it("restocks, refuses negative results and zero deltas, and forbids viewers", async () => {
    const p = await createProduct(org, { stock: 2 });
    const [{ s }] = await asUser(member, (tx) => tx`select public.adjust_stock(${p}, 5, 'restock', 'llegada') as s`);
    expect(s).toBe(7);
    await expect(asUser(member, (tx) => tx`select public.adjust_stock(${p}, -8, 'adjustment', null)`)).rejects.toThrow(/negative/);
    await expect(asUser(member, (tx) => tx`select public.adjust_stock(${p}, 0, 'adjustment', null)`)).rejects.toThrow(/zero/);
    await expect(asUser(member, (tx) => tx`select public.adjust_stock(${p}, 1, 'sale', null)`)).rejects.toThrow(/restock or adjustment/);
    await expect(asUser(viewer, (tx) => tx`select public.adjust_stock(${p}, 1, 'restock', null)`)).rejects.toThrow(/forbidden/);
    expect(await stockOf(p)).toBe(7);
  });
});

describe("AC12 audit", () => {
  it("every row changed by an action (including triggers) is audited with actor and request id", async () => {
    const a = await createProduct(org, { stock: 5 });
    const b = await createProduct(org, { stock: 5 });
    const order = await createDraftOrder(org, [{ productId: a, qty: 1 }, { productId: b, qty: 2 }]);
    const requestId = `req-${Date.now()}`;

    await confirm(member, order, requestId);

    const rows = await admin`select entity, action, actor_id, request_id from audit_log where request_id = ${requestId}`;
    const count = (entity: string, action: string) => rows.filter((r) => r.entity === entity && r.action === action).length;
    expect(count("products", "update")).toBe(2);
    expect(count("stock_movements", "insert")).toBe(2);
    expect(count("orders", "update")).toBe(1);
    expect(rows.every((r) => r.actor_id === member && r.request_id === requestId)).toBe(true);
  });

  it("trigger-driven changes are audited too (order total)", async () => {
    const p = await createProduct(org, { stock: 5 });
    const requestId = `req-total-${Date.now()}`;
    const [{ id: order }] = await asUser(member, (tx) => tx`insert into orders (org_id) values (${org}) returning id`, { requestId });
    await asUser(member, (tx) =>
      tx`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${org}, ${order}, ${p}, 1, 5)`, { requestId });
    const rows = await admin`select entity, action from audit_log where request_id = ${requestId}`;
    expect(rows.filter((r) => r.entity === "order_items" && r.action === "insert").length).toBe(1);
    expect(rows.filter((r) => r.entity === "orders" && r.action === "update").length).toBe(1);
  });

  it("invitation audit rows never contain the token hash", async () => {
    await asUser(adminUser, (tx) =>
      tx`insert into invitations (org_id, email, role, token_hash) values (${org}, 'audit@test.local', 'viewer', 'secret-hash-value')`);
    const rows = await admin`select diff::text as d from audit_log where entity = 'invitations' and org_id = ${org}`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.d.includes("secret-hash-value"))).toBe(false);
  });
});
