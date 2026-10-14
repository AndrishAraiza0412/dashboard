import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, admin, asUser, cleanup, closeAll, createOrg, createProduct, createUser, stockOf } from "./helpers";

// Phase 3: categories and products under RLS and per-role permissions; stock only through adjust_stock.
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

const newCategory = (user: string, org: string, name: string) =>
  asUser(user, (tx) => tx`insert into categories (org_id, name) values (${org}, ${name}) returning id`);

describe("categories", () => {
  it("a member creates, renames and deletes; a viewer cannot write", async () => {
    const [{ id }] = await newCategory(member, orgA, "Bebidas");
    await asUser(member, (tx) => tx`update categories set name = 'Café' where id = ${id}`);
    expect((await admin`select name from categories where id = ${id}`)[0].name).toBe("Café");

    await expect(newCategory(viewer, orgA, "Nope")).rejects.toThrow();
    await asUser(viewer, (tx) => tx`update categories set name = 'Hack' where id = ${id}`);
    expect((await admin`select name from categories where id = ${id}`)[0].name).toBe("Café"); // 0 rows touched
    await asUser(viewer, (tx) => tx`delete from categories where id = ${id}`);
    expect((await admin`select 1 from categories where id = ${id}`).length).toBe(1);

    await asUser(member, (tx) => tx`delete from categories where id = ${id}`);
    expect((await admin`select 1 from categories where id = ${id}`).length).toBe(0);
  });

  it("names are unique per org, and another org cannot see or write them", async () => {
    await newCategory(member, orgA, "Dup");
    await expect(newCategory(member, orgA, "Dup")).rejects.toMatchObject({ code: "23505" });
    await expect(newCategory(outsider, orgA, "Intruso")).rejects.toThrow();
    expect((await asUser(outsider, (tx) => tx`select id from categories where org_id = ${orgA}`)).length).toBe(0);
  });

  it("cannot be deleted while a product uses it", async () => {
    const [{ id }] = await newCategory(member, orgA, "Con productos");
    await asUser(member, (tx) => tx`insert into products (org_id, sku, name, category_id) values (${orgA}, 'cat-1', 'x', ${id})`);
    await expect(asUser(member, (tx) => tx`delete from categories where id = ${id}`)).rejects.toMatchObject({ code: "23503" });
  });
});

describe("products", () => {
  it("a member creates one with stock forced to 0; a viewer cannot", async () => {
    const [{ id, stock_qty }] = await asUser(
      member,
      (tx) => tx`insert into products (org_id, sku, name, price, stock_qty) values (${orgA}, 'p-1', 'Taza', 25.50, 999) returning id, stock_qty`,
    );
    expect(stock_qty).toBe(0);
    await expect(
      asUser(viewer, (tx) => tx`insert into products (org_id, sku, name) values (${orgA}, 'p-2', 'Nope')`),
    ).rejects.toThrow();
    expect((await admin`select 1 from products where id = ${id}`).length).toBe(1);
  });

  it("rejects duplicate SKUs, negative prices and a category from another org", async () => {
    await createProduct(orgA, { sku: "dup-sku" });
    await expect(
      asUser(member, (tx) => tx`insert into products (org_id, sku, name) values (${orgA}, 'dup-sku', 'x')`),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      asUser(member, (tx) => tx`insert into products (org_id, sku, name, price) values (${orgA}, 'neg', 'x', -1)`),
    ).rejects.toMatchObject({ code: "23514" });
    const [{ id: foreign }] = await newCategory(outsider, orgB, "Ajena");
    await expect(
      asUser(member, (tx) => tx`insert into products (org_id, sku, name, category_id) values (${orgA}, 'fk', 'x', ${foreign})`),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("members edit and deactivate, but cannot touch stock_qty or org_id; outsiders see nothing", async () => {
    const id = await createProduct(orgA, { stock: 5 });
    await asUser(member, (tx) => tx`update products set name = 'Nuevo', active = false where id = ${id}`);
    expect((await admin`select name, active from products where id = ${id}`)[0]).toMatchObject({ name: "Nuevo", active: false });

    await expect(asUser(member, (tx) => tx`update products set stock_qty = 500 where id = ${id}`)).rejects.toThrow();
    await expect(asUser(member, (tx) => tx`update products set org_id = ${orgB} where id = ${id}`)).rejects.toThrow();
    expect(await stockOf(id)).toBe(5);

    expect((await asUser(outsider, (tx) => tx`select id from products where id = ${id}`)).length).toBe(0);
    await asUser(outsider, (tx) => tx`update products set name = 'Hack' where id = ${id}`);
    expect((await admin`select name from products where id = ${id}`)[0].name).toBe("Nuevo");
  });
});

describe("adjust_stock", () => {
  const adjust = (user: string, product: string, delta: number, reason = "restock", note: string | null = null) =>
    asUser(user, (tx) => tx`select public.adjust_stock(${product}::uuid, ${delta}::integer, ${reason}::public.movement_reason, ${note}::text) as qty`);

  it("a member restocks and removes stock, leaving one movement each time", async () => {
    const id = await createProduct(orgA, { stock: 2 });
    expect((await adjust(member, id, 10, "restock", "caja nueva"))[0].qty).toBe(12);
    expect((await adjust(member, id, -4, "adjustment"))[0].qty).toBe(8);
    expect(await stockOf(id)).toBe(8);
    const moves = await admin`select delta, reason, note, created_by from stock_movements where product_id = ${id} order by created_at`;
    expect(moves.map((m) => m.delta)).toEqual([10, -4]);
    expect(moves[0]).toMatchObject({ reason: "restock", note: "caja nueva", created_by: member });
  });

  it("refuses negative stock, zero, sale reasons, viewers and other orgs", async () => {
    const id = await createProduct(orgA, { stock: 3 });
    await expect(adjust(member, id, -4)).rejects.toThrow(/negative/);
    await expect(adjust(member, id, 0)).rejects.toThrow(/zero/);
    await expect(adjust(member, id, 1, "sale")).rejects.toThrow(/reason/);
    await expect(adjust(viewer, id, 1)).rejects.toThrow(/forbidden/);
    await expect(adjust(outsider, id, 1)).rejects.toThrow(/forbidden/);
    expect(await stockOf(id)).toBe(3);
    expect((await admin`select 1 from stock_movements where product_id = ${id}`).length).toBe(0);
  });

  it("viewers read the history of their org; outsiders do not", async () => {
    const id = await createProduct(orgA, { stock: 0 });
    await adjust(member, id, 5);
    expect((await asUser(viewer, (tx) => tx`select id from stock_movements where product_id = ${id}`)).length).toBe(1);
    expect((await asUser(outsider, (tx) => tx`select id from stock_movements where product_id = ${id}`)).length).toBe(0);
    await expect(
      asUser(member, (tx) => tx`insert into stock_movements (org_id, product_id, delta, reason) values (${orgA}, ${id}, 1, 'restock')`),
    ).rejects.toThrow();
  });
});
