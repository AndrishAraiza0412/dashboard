import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, admin, asUser, cleanup, closeAll, createCustomer, createDraftOrder, createOrg, createProduct, createUser } from "./helpers";

// Phase 4: customers (soft delete) and draft-only editing of orders under per-role permissions.
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

describe("customers", () => {
  it("a member creates, edits and deactivates; a viewer and another org cannot write", async () => {
    const [{ id }] = await asUser(member, (tx) => tx`insert into customers (org_id, name) values (${orgA}, 'Ana') returning id`);
    await asUser(member, (tx) => tx`update customers set name = 'Ana B', email = 'ana@x.com', active = false where id = ${id}`);
    expect((await admin`select name, email, active from customers where id = ${id}`)[0]).toMatchObject({ name: "Ana B", email: "ana@x.com", active: false });

    await expect(asUser(viewer, (tx) => tx`insert into customers (org_id, name) values (${orgA}, 'x')`)).rejects.toThrow();
    await expect(asUser(outsider, (tx) => tx`insert into customers (org_id, name) values (${orgA}, 'x')`)).rejects.toThrow();
    await asUser(viewer, (tx) => tx`update customers set name = 'Hack' where id = ${id}`);
    await asUser(outsider, (tx) => tx`update customers set name = 'Hack' where id = ${id}`);
    expect((await admin`select name from customers where id = ${id}`)[0].name).toBe("Ana B");
    expect((await asUser(outsider, (tx) => tx`select id from customers where id = ${id}`)).length).toBe(0);
    expect((await asUser(viewer, (tx) => tx`select id from customers where id = ${id}`)).length).toBe(1);
  });

  it("have no DELETE privilege", async () => {
    const id = await createCustomer(orgA);
    await expect(asUser(member, (tx) => tx`delete from customers where id = ${id}`)).rejects.toThrow();
  });
});

describe("order lines", () => {
  it("are editable only while the order is a draft, and by members", async () => {
    const product = await createProduct(orgA, { stock: 10 });
    const order = await createDraftOrder(orgA, [{ productId: product, qty: 2 }]);
    const [{ id: line }] = await admin`select id from order_items where order_id = ${order}`;

    await asUser(member, (tx) => tx`update order_items set qty = 3, unit_price = 9.99 where id = ${line}`);
    expect((await admin`select total::text as t from orders where id = ${order}`)[0].t).toBe("29.97");
    await expect(asUser(member, (tx) => tx`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${orgA}, ${order}, ${product}, 1, 1)`)).rejects.toMatchObject({ code: "23505" });

    await asUser(viewer, (tx) => tx`update order_items set qty = 9 where id = ${line}`);
    await asUser(outsider, (tx) => tx`delete from order_items where id = ${line}`);
    expect((await admin`select qty from order_items where id = ${line}`)[0].qty).toBe(3);

    await asUser(member, (tx) => tx`select public.confirm_order(${order})`);
    await asUser(member, (tx) => tx`update order_items set qty = 1 where id = ${line}`);
    await asUser(member, (tx) => tx`delete from order_items where id = ${line}`);
    expect((await admin`select qty from order_items where id = ${line}`)[0].qty).toBe(3); // locked after confirm
    await asUser(member, (tx) => tx`update orders set notes = 'tarde' where id = ${order}`);
    expect((await admin`select notes from orders where id = ${order}`)[0].notes).toBeNull();
  });

  it("only accept a customer of the same org", async () => {
    const foreign = await createCustomer(orgB);
    const [{ id }] = await asUser(member, (tx) => tx`insert into orders (org_id) values (${orgA}) returning id`);
    await expect(asUser(member, (tx) => tx`update orders set customer_id = ${foreign} where id = ${id}`)).rejects.toMatchObject({ code: "23503" });
  });
});
