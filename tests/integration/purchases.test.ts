import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, admin, asUser, cleanup, closeAll, createOrg, createProduct, createUser } from "./helpers";

// Purchase orders: draft-only editing, stock rises only on receipt, per-role and per-org isolation.
let orgA: string, orgB: string, member: string, viewer: string, outsider: string;

beforeAll(async () => {
  [member, viewer, outsider] = await Promise.all([createUser(), createUser(), createUser()]);
  [orgA, orgB] = [await createOrg(), await createOrg()];
  await addMember(orgA, member, "member");
  await addMember(orgA, viewer, "viewer");
  await addMember(orgB, outsider, "admin");
});

afterAll(async () => {
  await cleanup();
  await closeAll();
});

const stockOf = async (id: string) => (await admin`select stock_qty from products where id = ${id}`)[0].stock_qty as number;

describe("purchase orders", () => {
  it("go draft -> ordered -> received, and only receiving adds stock", async () => {
    const product = await createProduct(orgA, { stock: 3 });
    const [{ id: supplier }] = await asUser(member, (tx) => tx`insert into suppliers (org_id, name) values (${orgA}, 'Proveedor') returning id`);
    // forged status/total/number are overwritten by the BEFORE INSERT trigger
    const [{ id: po }] = await asUser(member, (tx) => tx`insert into purchase_orders (org_id, status, total, number) values (${orgA}, 'received', 999, 7) returning id`);
    expect((await admin`select status, total::text as total, number from purchase_orders where id = ${po}`)[0]).toMatchObject({ status: "draft", total: "0.00", number: null });

    await asUser(member, (tx) => tx`insert into purchase_order_items (org_id, purchase_order_id, product_id, qty, unit_cost) values (${orgA}, ${po}, ${product}, 10, 12.50)`);
    expect((await admin`select total::text as t from purchase_orders where id = ${po}`)[0].t).toBe("125.00");

    await expect(asUser(member, (tx) => tx`select public.place_purchase_order(${po}::uuid)`)).rejects.toThrow(/no supplier/);
    await asUser(member, (tx) => tx`update purchase_orders set supplier_id = ${supplier} where id = ${po}`);
    await asUser(member, (tx) => tx`select public.place_purchase_order(${po}::uuid)`);
    expect(await stockOf(product)).toBe(3);

    // no longer a draft: lines are frozen
    await asUser(member, (tx) => tx`update purchase_order_items set qty = 99 where purchase_order_id = ${po}`);
    expect((await admin`select qty from purchase_order_items where purchase_order_id = ${po}`)[0].qty).toBe(10);

    await expect(asUser(viewer, (tx) => tx`select public.receive_purchase_order(${po}::uuid)`)).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(outsider, (tx) => tx`select public.receive_purchase_order(${po}::uuid)`)).rejects.toMatchObject({ code: "42501" });
    await asUser(member, (tx) => tx`select public.receive_purchase_order(${po}::uuid)`);
    expect(await stockOf(product)).toBe(13);
    expect((await admin`select delta, reason from stock_movements where purchase_order_id = ${po}`)[0]).toMatchObject({ delta: 10, reason: "purchase" });

    // received twice or cancelled after receipt: refused
    await expect(asUser(member, (tx) => tx`select public.receive_purchase_order(${po}::uuid)`)).rejects.toMatchObject({ code: "P0001" });
    await expect(asUser(member, (tx) => tx`select public.cancel_purchase_order(${po}::uuid)`)).rejects.toMatchObject({ code: "P0001" });
    expect(await stockOf(product)).toBe(13);
  });

  it("are invisible to other orgs and read-only for viewers", async () => {
    await expect(asUser(viewer, (tx) => tx`insert into purchase_orders (org_id) values (${orgA})`)).rejects.toThrow();
    await expect(asUser(outsider, (tx) => tx`insert into suppliers (org_id, name) values (${orgA}, 'x')`)).rejects.toThrow();
    expect((await asUser(outsider, (tx) => tx`select id from purchase_orders where org_id = ${orgA}`)).length).toBe(0);
    expect((await asUser(viewer, (tx) => tx`select id from purchase_orders where org_id = ${orgA}`)).length).toBeGreaterThan(0);
  });
});
