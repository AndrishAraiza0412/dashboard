// Demo organization with deterministic data (fixed PRNG seed; only the dates follow "today").
// Seeds through the same database functions the app uses, so stock always matches the movements:
// products are restocked with adjust_stock and every order goes through confirm_order.
//   node scripts/seed.ts --yes     recreate the demo org and its two users
//   node scripts/seed.ts --clean   remove them
// Dev/demo only: it connects as the owner role (DATABASE_URL_MIGRATE) and deletes the `demo` org first.
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const DEMO = { slug: "demo", name: "Tienda Deportiva Demo" };
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@demo.test"; // set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in .env.local to keep a fixed login across reseeds
const VIEWER_EMAIL = "demo@demo.test";
const VIEWER_PASSWORD = process.env.DEMO_VIEWER_PASSWORD ?? "choose-a-password"; // public by design: shown on the login page
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString("base64url");

// The seed deletes the users it is about to recreate, so it may only ever touch demo addresses.
if (!ADMIN_EMAIL.endsWith("@demo.test")) {
  console.error(`SEED_ADMIN_EMAIL must end with @demo.test (got ${ADMIN_EMAIL}): the seed deletes and recreates this user.`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.includes("--yes") && !args.includes("--clean")) {
  console.error("Refusing to run without --yes (recreates the demo org) or --clean (removes it).");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL_MIGRATE!, { prepare: false, max: 1, connect_timeout: 15 });

// mulberry32: tiny seeded PRNG so every run builds the same catalog and order pattern
let state = 20261014;
const rand = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(xs: T[]): T => xs[int(0, xs.length - 1)];

async function clean() {
  const orgs = await sql`select id from organizations where slug = ${DEMO.slug}`;
  for (const { id } of orgs) {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.deleting_org', ${id}, true)`;
      await tx`delete from organizations where id = ${id}`;
    });
    await sql`delete from audit_log where org_id = ${id}`;
  }
  const users = await sql`select id from auth.users where email in (${ADMIN_EMAIL}, ${VIEWER_EMAIL})`;
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await sql`delete from audit_log where actor_id = any(${ids})`;
    await sql`delete from auth.users where id = any(${ids})`;
  }
}

async function createUser(email: string, password: string, name: string): Promise<string> {
  // Straight into auth.users (no auth.identities row, which would break password sign-in); the profile trigger does the rest.
  const [{ id }] = await sql`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', ${email},
            extensions.crypt(${password}, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', ${sql.json({ full_name: name })}, now(), now(), '', '', '', '')
    returning id`;
  return id;
}

async function seed() {
  await clean();
  const adminId = await createUser(ADMIN_EMAIL, ADMIN_PASSWORD, "Admin Demo");
  const viewerId = await createUser(VIEWER_EMAIL, VIEWER_PASSWORD, "Visitante Demo");
  const [{ id: org }] = await sql`insert into organizations (name, slug, is_demo) values (${DEMO.name}, ${DEMO.slug}, true) returning id`;
  await sql`insert into memberships (org_id, user_id, role) values (${org}, ${adminId}, 'admin'), (${org}, ${viewerId}, 'viewer')`;

  // A sportswear store: brand-name catalog, SKU = brand-category-model.
  const catNames = ["Tenis", "Camisetas", "Sudaderas", "Shorts y pants", "Calcetas", "Accesorios"];
  const cats: Record<string, string> = {};
  for (const name of catNames) {
    const [{ id }] = await sql`insert into categories (org_id, name) values (${org}, ${name}) returning id`;
    cats[name] = id;
  }
  const catalog: [sku: string, name: string, cat: string, price: number][] = [
    ["NIK-TEN-AM90", "Nike Air Max 90", "Tenis", 2899], ["NIK-TEN-AF1", "Nike Air Force 1 '07", "Tenis", 2499], ["NIK-TEN-PEG41", "Nike Pegasus 41", "Tenis", 2799],
    ["ADI-TEN-SAMBA", "Adidas Samba OG", "Tenis", 2399], ["ADI-TEN-UB", "Adidas Ultraboost Light", "Tenis", 3999], ["ADI-TEN-GAZ", "Adidas Gazelle", "Tenis", 2199],
    ["PUM-TEN-SUEDE", "Puma Suede Classic", "Tenis", 1799], ["NB-TEN-530", "New Balance 530", "Tenis", 2299], ["ASC-TEN-GEL", "Asics Gel-Kayano 31", "Tenis", 3499],
    ["NIK-CAM-DRIFIT", "Nike Dri-FIT Legend", "Camisetas", 599], ["NIK-CAM-JORDAN", "Jordan Jumpman Tee", "Camisetas", 749], ["ADI-CAM-3S", "Adidas Essentials 3 Franjas", "Camisetas", 549],
    ["ADI-CAM-SELMX", "Jersey Selección Mexicana Local", "Camisetas", 1899], ["PUM-CAM-ESS", "Puma Essentials Logo", "Camisetas", 449], ["UA-CAM-TECH", "Under Armour Tech 2.0", "Camisetas", 599],
    ["NIK-SUD-CLUB", "Nike Sportswear Club Fleece", "Sudaderas", 1299], ["ADI-SUD-TREF", "Adidas Trefoil Hoodie", "Sudaderas", 1399], ["PUM-SUD-ESS", "Puma Essentials Hoodie", "Sudaderas", 999],
    ["NIK-SHO-CHAL", "Nike Challenger 7\"", "Shorts y pants", 699], ["ADI-PAN-TIRO", "Adidas Tiro 24 Pants", "Shorts y pants", 1099], ["UA-SHO-LAUNCH", "Under Armour Launch 5\"", "Shorts y pants", 649],
    ["NIK-CAL-EVERY", "Calcetas Nike Everyday (3 pares)", "Calcetas", 349], ["ADI-CAL-CUSH", "Calcetas Adidas Cushioned (3 pares)", "Calcetas", 299], ["PUM-CAL-QTR", "Calcetas Puma Quarter (6 pares)", "Calcetas", 399],
    ["UA-CAL-RUN", "Calcetas Under Armour Run No Show", "Calcetas", 249],
    ["NIK-ACC-GORRA", "Gorra Nike Club", "Accesorios", 549], ["ADI-ACC-MOCH", "Mochila Adidas Classic", "Accesorios", 899], ["NIK-ACC-BALON", "Balón Nike Strike", "Accesorios", 699],
    ["NIK-ACC-BOTE", "Botella Nike Hypercharge 700 ml", "Accesorios", 449], ["PUM-ACC-MALE", "Maleta deportiva Puma Phase", "Accesorios", 799], ["ADI-ACC-MUN", "Muñequeras Adidas (par)", "Accesorios", 199],
    ["REE-ACC-TAPETE", "Tapete de yoga Reebok", "Accesorios", 699],
  ];
  const products: { id: string; price: number; cost: number; shoes: boolean }[] = [];
  for (const [i, [sku, name, cat, price]] of catalog.entries()) {
    const cost = Math.round(price * (0.5 + rand() * 0.15));
    const shoes = cat === "Tenis";
    const [{ id }] = await sql`
      insert into products (org_id, sku, name, category_id, price, cost, reorder_level, active)
      values (${org}, ${sku}, ${name}, ${cats[cat]}, ${price}, ${cost}, ${shoes ? int(4, 8) : int(8, 15)}, ${i !== catalog.length - 1})
      returning id`;
    products.push({ id, price, cost, shoes });
  }
  const supplierNames: [string, string, string][] = [
    ["Nike de México (distribución)", "pedidos@nike-distribuidor.ejemplo.com", "55 1234 5600"],
    ["Adidas Industrial MX", "compras@adidas-mx.ejemplo.com", "55 2345 6700"],
    ["Puma Distribución", "ventas@puma-dist.ejemplo.com", "33 3456 7800"],
    ["Deportes Mayoreo del Bajío", "contacto@mayoreobajio.ejemplo.com", "477 456 7890"],
  ];
  const suppliers: string[] = [];
  for (const [name, email, phone] of supplierNames) {
    const [{ id }] = await sql`insert into suppliers (org_id, name, email, phone) values (${org}, ${name}, ${email}, ${phone}) returning id`;
    suppliers.push(id);
  }
  const first = ["Lucía", "Mateo", "Valentina", "Santiago", "Camila", "Diego", "Sofía", "Emiliano", "Renata", "Andrés", "Paula", "Iván"];
  const last = ["Pérez", "García", "Hernández", "López", "Martínez", "Ramírez", "Torres", "Flores"];
  const customers: string[] = [];
  for (const n of first) {
    const [{ id }] = await sql`
      insert into customers (org_id, name, email) values (${org}, ${`${n} ${pick(last)}`}, ${`${n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}@ejemplo.com`}) returning id`;
    customers.push(id);
  }

  // Everything below runs as the demo admin, through the real functions.
  const asAdmin = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: adminId, role: "authenticated", email: ADMIN_EMAIL })}, true)`;
      await tx`set local role authenticated`;
      return fn(tx);
    }) as Promise<T>;

  const active = products.slice(0, -1);
  await asAdmin(async (tx) => {
    for (const p of products) await tx`select public.adjust_stock(${p.id}::uuid, ${p.shoes ? int(40, 80) : int(80, 160)}::integer, 'restock'::public.movement_reason, 'Stock inicial')`;
  });

  const DAY = 86_400_000;
  const now = Date.now();
  let confirmed = 0, fulfilled = 0, cancelled = 0;
  for (let n = 0; n < 70; n++) {
    const at = new Date(now - rand() * 85 * DAY - 3_600_000);
    const lines = new Set<number>();
    while (lines.size < int(1, 4)) lines.add(int(0, active.length - 1));
    const [{ id: order }] = await sql`insert into orders (org_id, customer_id, created_at) values (${org}, ${rand() < 0.85 ? pick(customers) : null}, ${at}) returning id`;
    for (const i of lines) {
      await sql`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${org}, ${order}, ${active[i].id}, ${int(1, 3)}, ${active[i].price})`;
    }
    await asAdmin((tx) => tx`select public.confirm_order(${order}::uuid)`);
    await sql`update orders set confirmed_at = ${at} where id = ${order}`;
    await sql`update stock_movements set created_at = ${at} where order_id = ${order}`;
    confirmed++;
    const roll = rand();
    if (roll < 0.6) { await asAdmin((tx) => tx`select public.fulfill_order(${order}::uuid)`); fulfilled++; }
    else if (roll < 0.66) { await asAdmin((tx) => tx`select public.cancel_order(${order}::uuid)`); cancelled++; }
  }
  // Purchase orders to suppliers, through the real functions: some received in the past, one on its way, one draft.
  const purchase = async (daysAgo: number, end: "received" | "ordered" | "draft") => {
    const at = new Date(now - daysAgo * DAY);
    const [{ id: po }] = await sql`insert into purchase_orders (org_id, supplier_id, created_at) values (${org}, ${pick(suppliers)}, ${at}) returning id`;
    const lines = new Set<number>();
    while (lines.size < int(2, 5)) lines.add(int(0, active.length - 1));
    for (const i of lines) {
      await sql`insert into purchase_order_items (org_id, purchase_order_id, product_id, qty, unit_cost) values (${org}, ${po}, ${active[i].id}, ${active[i].shoes ? int(6, 12) : int(12, 36)}, ${active[i].cost})`;
    }
    if (end === "draft") return;
    await asAdmin((tx) => tx`select public.place_purchase_order(${po}::uuid)`);
    await sql`update purchase_orders set ordered_at = ${at} where id = ${po}`;
    if (end === "ordered") return;
    await asAdmin((tx) => tx`select public.receive_purchase_order(${po}::uuid)`);
    const received = new Date(at.getTime() + 3 * DAY);
    await sql`update purchase_orders set received_at = ${received} where id = ${po}`;
    await sql`update stock_movements set created_at = ${received} where purchase_order_id = ${po}`;
  };
  for (const d of [80, 62, 45, 30, 14]) await purchase(d, "received");
  await purchase(4, "ordered");
  await purchase(1, "draft");

  // a few products running low, so the dashboard has something to show
  await asAdmin(async (tx) => {
    // three low, one sold out (index 12)
    for (const [n, p] of [...active.slice(2, 5), active[12]].entries()) {
      const [{ stock_qty, reorder_level }] = await tx`select stock_qty, reorder_level from products where id = ${p.id}`;
      const target = n === 3 ? 0 : Math.max(1, reorder_level - 2);
      if (stock_qty !== target) await tx`select public.adjust_stock(${p.id}::uuid, ${target - stock_qty}::integer, 'adjustment'::public.movement_reason, 'Conteo físico')`;
    }
  });

  console.log(`seeded org "${DEMO.slug}": ${products.length} products, ${customers.length} customers, ${suppliers.length} suppliers, 7 purchase orders, ${confirmed} orders (${fulfilled} completed, ${cancelled} cancelled)`);
  console.log(`  viewer: ${VIEWER_EMAIL} / ${VIEWER_PASSWORD}`);
  // A password supplied through the environment (CI secret) is never echoed back.
  console.log(`  admin:  ${ADMIN_EMAIL} / ${process.env.SEED_ADMIN_PASSWORD ? "(from SEED_ADMIN_PASSWORD)" : ADMIN_PASSWORD}`);
}

try {
  if (args.includes("--clean")) {
    await clean();
    console.log("demo org and users removed");
  } else {
    await seed();
  }
} catch (e) {
  const err = e as { code?: string; message: string };
  console.error("ERROR", err.code ?? "", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
