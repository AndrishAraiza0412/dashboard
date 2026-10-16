import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember, admin, asUser, cleanup, closeAll, createCustomer, createDraftOrder, createOrg, createProduct,
  createUser, runtime, sha256hex,
} from "./helpers";

// AC1-AC5, AC7: tenant isolation, no privilege escalation, suspended orgs.
let orgA: string, orgB: string;
let adminA: string, memberA: string, viewerA: string, adminB: string, platform: string;
let productB: string, orderB: string, customerB: string, categoryB: string;

beforeAll(async () => {
  [adminA, memberA, viewerA, adminB, platform] = await Promise.all([
    createUser(), createUser(), createUser(), createUser(), createUser(),
  ]);
  orgA = await createOrg();
  orgB = await createOrg();
  await addMember(orgA, adminA, "admin");
  await addMember(orgA, memberA, "member");
  await addMember(orgA, viewerA, "viewer");
  await addMember(orgB, adminB, "admin");
  await admin`insert into platform_admins (user_id) values (${platform})`;

  productB = await createProduct(orgB, { stock: 10 });
  customerB = await createCustomer(orgB);
  orderB = await createDraftOrder(orgB, [{ productId: productB, qty: 2 }]);
  [{ id: categoryB }] = await admin`insert into categories (org_id, name) values (${orgB}, 'cat-b') returning id`;
  await admin`insert into stock_movements (org_id, product_id, delta, reason) values (${orgB}, ${productB}, 10, 'restock')`;
  await admin`insert into invitations (org_id, email, role, token_hash) values (${orgB}, 'x@test.local', 'viewer', ${sha256hex("b")})`;
  // Make sure org A has data too so "0 rows" is a real statement
  await createProduct(orgA, { stock: 1 });
});

afterAll(async () => {
  await cleanup();
  await closeAll();
});

const TABLES = [
  "categories", "products", "customers", "orders", "order_items", "stock_movements",
  "invitations", "memberships", "organizations", "audit_log",
] as const;

describe("AC1 isolation: user of org A against org B", () => {
  for (const table of TABLES) {
    it(`cannot read ${table}`, async () => {
      const col = table === "organizations" ? "id" : "org_id";
      const rows = await asUser(adminA, (tx) => tx.unsafe(`select 1 from public.${table} where ${col} = '${orgB}'`));
      expect(rows.length).toBe(0);
    });
  }

  const inserts: Record<string, string> = {
    categories: `insert into categories (org_id, name) values ('${"$B"}', 'x')`,
    products: `insert into products (org_id, sku, name) values ('$B', 'x', 'x')`,
    customers: `insert into customers (org_id, name) values ('$B', 'x')`,
    orders: `insert into orders (org_id) values ('$B')`,
    invitations: `insert into invitations (org_id, email, role, token_hash) values ('$B', 'y@test.local', 'viewer', 'h')`,
  };
  for (const [table, q] of Object.entries(inserts)) {
    it(`cannot insert into ${table}`, async () => {
      await expect(asUser(adminA, (tx) => tx.unsafe(q.replace("$B", orgB)))).rejects.toThrow(/row-level security/);
    });
  }

  it("cannot insert an order line into org B's order", async () => {
    await expect(
      asUser(adminA, (tx) =>
        tx.unsafe(
          `insert into order_items (org_id, order_id, product_id, qty, unit_price) values ('${orgB}', '${orderB}', '${productB}', 1, 1)`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  const writes: [string, string][] = [
    ["categories", `update categories set name = 'hacked' where org_id = '$B'`],
    ["categories", `delete from categories where org_id = '$B'`],
    ["products", `update products set name = 'hacked' where org_id = '$B'`],
    ["products", `delete from products where org_id = '$B'`],
    ["customers", `update customers set name = 'hacked' where org_id = '$B'`],
    ["orders", `update orders set notes = 'hacked' where org_id = '$B'`],
    ["order_items", `update order_items set qty = 99 where org_id = '$B'`],
    ["order_items", `delete from order_items where org_id = '$B'`],
    ["invitations", `delete from invitations where org_id = '$B'`],
    ["organizations", `update organizations set name = 'hacked' where id = '$B'`],
  ];
  for (const [table, q] of writes) {
    it(`touches 0 rows: ${q.split(" where")[0]}`, async () => {
      const res = await asUser(adminA, (tx) => tx.unsafe(q.replaceAll("$B", orgB)));
      expect(res.count, table).toBe(0);
    });
  }

  it("cannot call business functions on org B objects", async () => {
    const calls = [
      `select public.confirm_order('${orderB}')`,
      `select public.cancel_order('${orderB}')`,
      `select public.fulfill_order('${orderB}')`,
      `select public.adjust_stock('${productB}', 5, 'restock', null)`,
      `select public.change_member_role('${orgB}', '${adminB}', 'viewer')`,
      `select public.remove_member('${orgB}', '${adminB}')`,
    ];
    for (const q of calls) {
      await expect(asUser(adminA, (tx) => tx.unsafe(q)), q).rejects.toThrow(/forbidden/);
    }
  });

  it("org B data is intact", async () => {
    const [{ n }] = await admin`select count(*)::int as n from products where org_id = ${orgB} and name <> 'hacked' and stock_qty = 10`;
    expect(n).toBe(1);
    const [{ c }] = await admin`select count(*)::int as c from categories where org_id = ${orgB} and id = ${categoryB}`;
    expect(c).toBe(1);
    const [{ d }] = await admin`select count(*)::int as d from customers where id = ${customerB}`;
    expect(d).toBe(1);
  });
});

describe("AC2 fails closed outside withOrg", () => {
  for (const table of TABLES) {
    it(`${table}: 0 rows without claims`, async () => {
      const rows = await runtime.unsafe(`select 1 from public.${table}`).catch((e: Error) => e);
      if (rows instanceof Error) expect(rows.message).toMatch(/permission denied/);
      else expect(rows.length).toBe(0);
    });
  }
});

describe("AC3 catalog", () => {
  it("every public table has RLS enabled", async () => {
    const rows = await admin`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("anon has no table privileges and cannot execute any public function", async () => {
    const [{ n }] = await admin`
      select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'`;
    expect(n).toBe(0);
    const fns = await admin`
      select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')`;
    expect(fns.map((f) => f.proname)).toEqual([]);
  });

  it("tables without policies grant nothing to authenticated", async () => {
    const bare = await admin`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)`;
    expect(bare.map((r) => r.relname).sort()).toEqual(["org_counters", "platform_admins"]);
    for (const { relname } of bare) {
      const [{ ok }] = await admin`
        select has_any_column_privilege('authenticated', ${`public.${relname}`}, 'select,insert,update,references') as ok`;
      expect(ok, relname).toBe(false);
    }
  });

  it("every SECURITY DEFINER function pins search_path", async () => {
    const rows = await admin`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`;
    expect(rows.map((r) => r.proname)).toEqual([]);
  });
});

describe("AC4 no privilege escalation", () => {
  const denied = (user: () => string, q: () => string, re = /permission denied/) =>
    asUser(user(), (tx) => tx.unsafe(q())).then(
      () => { throw new Error(`expected failure for: ${q()}`); },
      (e: Error) => expect(e.message).toMatch(re),
    );

  it("cannot make themselves a platform admin", () =>
    denied(() => adminA, () => `insert into platform_admins (user_id) values ('${adminA}')`));

  it("cannot change roles or add memberships directly", async () => {
    await denied(() => viewerA, () => `update memberships set role = 'admin' where user_id = '${viewerA}'`);
    await denied(() => adminA, () => `update memberships set role = 'viewer' where user_id = '${memberA}'`);
    await denied(() => adminA, () => `insert into memberships (org_id, user_id, role) values ('${orgA}', '${adminB}', 'admin')`);
    await denied(() => adminA, () => `delete from memberships where user_id = '${memberA}'`);
  });

  it("cannot edit modules, suspension, counters, stock, movements or audit", async () => {
    await denied(() => adminA, () => `update organizations set enabled_modules = '{inventory}' where id = '${orgA}'`);
    await denied(() => adminA, () => `update organizations set suspended_at = now() where id = '${orgA}'`);
    await denied(() => adminA, () => `update organizations set is_demo = true where id = '${orgA}'`);
    await denied(() => adminA, () => `insert into org_counters (org_id, next_order_no) values ('${orgA}', 999)`);
    await denied(() => adminA, () => `update products set stock_qty = 999 where org_id = '${orgA}'`);
    await denied(() => adminA, () => `insert into stock_movements (org_id, product_id, delta, reason) values ('${orgA}', '${productB}', 1, 'restock')`);
    await denied(() => adminA, () => `update audit_log set action = 'x'`);
    await denied(() => adminA, () => `delete from audit_log`);
    await denied(() => adminA, () => `insert into audit_log (org_id, action, entity) values ('${orgA}', 'x', 'x')`);
  });

  it("cannot move rows between orgs by changing id or org_id", async () => {
    await denied(() => adminA, () => `update products set org_id = '${orgB}' where org_id = '${orgA}'`);
    await denied(() => adminA, () => `update products set id = gen_random_uuid() where org_id = '${orgA}'`);
    await denied(() => adminA, () => `update categories set org_id = '${orgB}'`);
  });

  it("viewers cannot write or call stock/order functions", async () => {
    await expect(
      asUser(viewerA, (tx) => tx`insert into categories (org_id, name) values (${orgA}, 'v')`),
    ).rejects.toThrow(/row-level security/);
    const [{ id: product }] = await admin`select id from products where org_id = ${orgA} limit 1`;
    const order = await createDraftOrder(orgA, [{ productId: product, qty: 1 }]);
    for (const q of [
      `select public.confirm_order('${order}')`,
      `select public.cancel_order('${order}')`,
      `select public.adjust_stock('${product}', 1, 'restock', null)`,
    ]) {
      await expect(asUser(viewerA, (tx) => tx.unsafe(q)), q).rejects.toThrow(/forbidden/);
    }
  });

  it("members cannot manage members or invitations", async () => {
    await expect(
      asUser(memberA, (tx) => tx`select public.change_member_role(${orgA}, ${viewerA}, 'admin')`),
    ).rejects.toThrow(/forbidden/);
    await expect(
      asUser(memberA, (tx) => tx`insert into invitations (org_id, email, role, token_hash) values (${orgA}, 'm@test.local', 'viewer', 'h')`),
    ).rejects.toThrow(/row-level security/);
  });

  it("forged values on insert are overwritten by triggers", async () => {
    const forgedProduct = await asUser(memberA, (tx) =>
      tx`insert into products (org_id, sku, name, stock_qty) values (${orgA}, 'forge', 'forge', 999) returning stock_qty`);
    expect(forgedProduct[0].stock_qty).toBe(0);

    const forgedOrder = await asUser(memberA, (tx) =>
      tx`insert into orders (org_id, number, status, total, confirmed_at) values (${orgA}, 7, 'confirmed', 500, now())
         returning number, status, total::text as total, confirmed_at`);
    expect(forgedOrder[0]).toMatchObject({ number: null, status: "draft", total: "0.00", confirmed_at: null });

    const forgedInvite = await asUser(adminA, (tx) =>
      tx`insert into invitations (org_id, email, role, token_hash, invited_by, expires_at, accepted_at)
         values (${orgA}, 'f@test.local', 'viewer', ${sha256hex("forge")}, ${adminB}, now() + interval '10 years', now())
         returning invited_by, accepted_at, expires_at < now() + interval '8 days' as short`);
    expect(forgedInvite[0].invited_by).toBe(adminA);
    expect(forgedInvite[0].accepted_at).toBeNull();
    expect(forgedInvite[0].short).toBe(true);
  });
});

describe("AC5 platform admin functions", () => {
  it("are forbidden for everyone else, including org admins", async () => {
    const calls = [
      `select public.admin_create_org('n', 'slug-x', 'MXN', 'UTC', 'a@test.local', 'h')`,
      `select public.admin_set_modules('${orgA}', '{inventory}')`,
      `select public.admin_suspend_org('${orgA}', true)`,
      `select * from public.admin_list_orgs()`,
    ];
    for (const q of calls) {
      await expect(asUser(adminA, (tx) => tx.unsafe(q)), q).rejects.toThrow(/forbidden/);
    }
  });

  it("work for a platform admin and are audited with the real actor", async () => {
    const slug = `p-${Date.now()}`;
    const reqId = `req-${Date.now()}`;
    const [{ id }] = await asUser(
      platform,
      (tx) => tx`select public.admin_create_org('Cliente', ${slug}, 'MXN', 'America/Mexico_City', 'owner@test.local', ${sha256hex(slug)}) as id`,
      { requestId: reqId },
    );
    expect(id).toBeTruthy();
    await asUser(platform, (tx) => tx`select public.admin_set_modules(${id}, '{inventory}')`);
    const list = await asUser(platform, (tx) => tx`select id from public.admin_list_orgs()`);
    expect(list.map((r) => r.id)).toContain(id);
    const audit = await admin`select actor_id, request_id from audit_log where org_id = ${id} and request_id = ${reqId}`;
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((r) => r.actor_id === platform)).toBe(true);
    // register for cleanup
    await admin.begin(async (tx) => {
      await tx`select set_config('app.deleting_org', ${id}, true)`;
      await tx`delete from organizations where id = ${id}`;
    });
    await admin`delete from audit_log where org_id = ${id}`;
  });

  it("sales needs inventory", async () => {
    await expect(
      asUser(platform, (tx) => tx`select public.admin_set_modules(${orgA}, '{sales}')`),
    ).rejects.toThrow(/organizations_sales_needs_inventory/);
  });

  it("purchases needs inventory, and unknown modules are refused", async () => {
    await expect(asUser(platform, (tx) => tx`select public.admin_set_modules(${orgA}, '{purchases}')`)).rejects.toThrow(/organizations_purchases_needs_inventory/);
    await expect(asUser(platform, (tx) => tx`select public.admin_set_modules(${orgA}, '{inventory,payroll}')`)).rejects.toThrow(/organizations_modules_known/);
  });
});

describe("AC7 suspended organization", () => {
  it("hides data and blocks functions, then restores", async () => {
    const [{ id: product }] = await admin`select id from products where org_id = ${orgA} limit 1`;
    await asUser(platform, (tx) => tx`select public.admin_suspend_org(${orgA}, true)`);
    try {
      expect((await asUser(memberA, (tx) => tx`select id from organizations`)).length).toBe(0);
      expect((await asUser(memberA, (tx) => tx`select id from products`)).length).toBe(0);
      await expect(
        asUser(memberA, (tx) => tx`select public.adjust_stock(${product}, 1, 'restock', null)`),
      ).rejects.toThrow(/forbidden/);
    } finally {
      await asUser(platform, (tx) => tx`select public.admin_suspend_org(${orgA}, false)`);
    }
    expect((await asUser(memberA, (tx) => tx`select id from organizations`)).length).toBe(1);
  });
});
