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

const DEMO = { slug: "demo", name: "Demo" };
const ADMIN_EMAIL = "admin@demo.test";
const VIEWER_EMAIL = "demo@demo.test";
const VIEWER_PASSWORD = process.env.DEMO_VIEWER_PASSWORD ?? "choose-a-password"; // public by design: shown on the login page
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString("base64url");

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
            '{"provider":"email","providers":["email"]}', ${JSON.stringify({ full_name: name })}, now(), now(), '', '', '', '')
    returning id`;
  return id;
}

async function seed() {
  await clean();
  const adminId = await createUser(ADMIN_EMAIL, ADMIN_PASSWORD, "Admin Demo");
  const viewerId = await createUser(VIEWER_EMAIL, VIEWER_PASSWORD, "Visitante Demo");
  const [{ id: org }] = await sql`insert into organizations (name, slug, is_demo) values (${DEMO.name}, ${DEMO.slug}, true) returning id`;
  await sql`insert into memberships (org_id, user_id, role) values (${org}, ${adminId}, 'admin'), (${org}, ${viewerId}, 'viewer')`;

  const catNames = ["Bebidas", "Snacks", "Panadería", "Limpieza", "Papelería"];
  const cats: Record<string, string> = {};
  for (const name of catNames) {
    const [{ id }] = await sql`insert into categories (org_id, name) values (${org}, ${name}) returning id`;
    cats[name] = id;
  }
  const catalog: [string, string, number][] = [
    ["Café molido 500 g", "Bebidas", 129], ["Té verde caja", "Bebidas", 69], ["Agua mineral 1 L", "Bebidas", 24], ["Jugo de naranja", "Bebidas", 38],
    ["Refresco cola 600 ml", "Bebidas", 22], ["Galletas de avena", "Snacks", 32], ["Papas fritas", "Snacks", 28], ["Barra de granola", "Snacks", 19],
    ["Cacahuates salados", "Snacks", 26], ["Chocolate amargo", "Snacks", 45], ["Pan de caja", "Panadería", 48], ["Conchas (6 pzas)", "Panadería", 54],
    ["Bolillo (10 pzas)", "Panadería", 35], ["Croissant", "Panadería", 29], ["Detergente líquido", "Limpieza", 89], ["Jabón de trastes", "Limpieza", 41],
    ["Cloro 1 L", "Limpieza", 27], ["Papel higiénico 12 rollos", "Limpieza", 98], ["Cuaderno profesional", "Papelería", 52], ["Bolígrafos (caja 12)", "Papelería", 64],
    ["Marcadores (set 6)", "Papelería", 79], ["Carpeta tamaño carta", "Papelería", 36], ["Notas adhesivas", "Papelería", 23], ["Tijeras escolares", "Papelería", 31],
  ];
  const products: { id: string; price: number }[] = [];
  for (const [i, [name, cat, price]] of catalog.entries()) {
    const [{ id }] = await sql`
      insert into products (org_id, sku, name, category_id, price, cost, reorder_level, active)
      values (${org}, ${`SKU-${String(i + 1).padStart(3, "0")}`}, ${name}, ${cats[cat]}, ${price}, ${Math.round(price * (0.55 + rand() * 0.2) * 100) / 100}, ${int(5, 15)}, ${i !== catalog.length - 1})
      returning id`;
    products.push({ id, price });
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
    for (const p of products) await tx`select public.adjust_stock(${p.id}::uuid, ${int(150, 300)}::integer, 'restock'::public.movement_reason, 'Stock inicial')`;
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
      await sql`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${org}, ${order}, ${active[i].id}, ${int(1, 5)}, ${active[i].price})`;
    }
    await asAdmin((tx) => tx`select public.confirm_order(${order}::uuid)`);
    await sql`update orders set confirmed_at = ${at} where id = ${order}`;
    await sql`update stock_movements set created_at = ${at} where order_id = ${order}`;
    confirmed++;
    const roll = rand();
    if (roll < 0.6) { await asAdmin((tx) => tx`select public.fulfill_order(${order}::uuid)`); fulfilled++; }
    else if (roll < 0.66) { await asAdmin((tx) => tx`select public.cancel_order(${order}::uuid)`); cancelled++; }
  }
  // a few products running low, so the dashboard has something to show
  await asAdmin(async (tx) => {
    for (const p of active.slice(2, 5)) {
      const [{ stock_qty, reorder_level }] = await tx`select stock_qty, reorder_level from products where id = ${p.id}`;
      await tx`select public.adjust_stock(${p.id}::uuid, ${-(stock_qty - Math.max(0, reorder_level - 2))}::integer, 'adjustment'::public.movement_reason, 'Conteo físico')`;
    }
  });
  console.log(`seeded org "${DEMO.slug}": ${products.length} products, ${customers.length} customers, ${confirmed} orders (${fulfilled} completed, ${cancelled} cancelled)`);
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
