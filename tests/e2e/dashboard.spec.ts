import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// Dashboard in a real browser: KPIs, range presets, module gating, empty state, a11y and 375px.
const sql = postgres(process.env.DATABASE_URL_MIGRATE!, { prepare: false, max: 1 });
const run = randomUUID().slice(0, 8);
const PASSWORD = "correct horse battery staple";
const user = { id: randomUUID(), email: `dash-${run}@test.local` };
const orgs = {
  full: { id: "", slug: `e2e-d1-${run}`, name: `Tablero ${run}` },
  inv: { id: "", slug: `e2e-d2-${run}`, name: `Solo inventario ${run}` },
  empty: { id: "", slug: `e2e-d3-${run}`, name: `Sin ventas ${run}` },
};

test.beforeAll(async () => {
  await sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values (${user.id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${user.email},
            extensions.crypt(${PASSWORD}, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`;
  for (const o of Object.values(orgs)) {
    [{ id: o.id }] = await sql`insert into organizations (name, slug) values (${o.name}, ${o.slug}) returning id`;
    await sql`insert into memberships (org_id, user_id, role) values (${o.id}, ${user.id}, 'admin')`;
  }
  await sql`update organizations set enabled_modules = '{inventory}' where id = ${orgs.inv.id}`;
  const f = orgs.full.id;
  const [{ id: cat }] = await sql`insert into categories (org_id, name) values (${f}, 'Café') returning id`;
  const [{ id: p1 }] = await sql`insert into products (org_id, sku, name, stock_qty, reorder_level, category_id) values (${f}, 'C1', 'Café molido', 2, 5, ${cat}) returning id`;
  const [{ id: p2 }] = await sql`insert into products (org_id, sku, name, stock_qty, reorder_level) values (${f}, 'T1', 'Taza azul', 20, 5) returning id`;
  await sql`insert into products (org_id, sku, name, stock_qty, reorder_level) values (${orgs.inv.id}, 'X1', 'Hoja', 0, 3)`;
  for (const [status, ago, lines] of [
    ["confirmed", "1 day", [[p1, 3, "100"]]],
    ["fulfilled", "2 days", [[p2, 2, "50"], [p1, 1, "100"]]],
    ["confirmed", "40 days", [[p2, 1, "50"]]],
  ] as const) {
    const [{ id }] = await sql`insert into orders (org_id, status, confirmed_at) values (${f}, ${status}, now() - ${ago}::interval) returning id`;
    for (const [pid, qty, price] of lines) {
      await sql`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${f}, ${id}, ${pid}, ${qty}, ${price})`;
    }
  }
});

test.afterAll(async () => {
  for (const o of Object.values(orgs)) {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.deleting_org', ${o.id}, true)`;
      await tx`delete from organizations where id = ${o.id}`;
    });
    await sql`delete from audit_log where org_id = ${o.id}`;
  }
  await sql`delete from audit_log where actor_id = ${user.id}`;
  await sql`delete from auth.users where id = ${user.id}`;
  await sql.end();
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
const noSeriousViolations = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
};

test("KPIs, range presets and charts for an org with sales and inventory", async ({ page }) => {
  await login(page);
  await page.goto(`/o/${orgs.full.slug}`);
  const tile = (label: string) => page.locator("div.rounded-lg", { has: page.getByText(label, { exact: true }) }).filter({ visible: true }).first();

  // 30d default: 2 orders in range (the 40-day-old one is outside) = 3*100 + 2*50 + 100 = 500
  await expect(tile("Ingresos")).toContainText("$500.00");
  await expect(tile("Pedidos")).toContainText("2");
  await expect(tile("Ticket promedio")).toContainText("$250.00");
  await expect(tile("Stock bajo")).toContainText("1");
  await expect(page.getByRole("heading", { name: "Productos más vendidos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ventas por categoría" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Café molido" })).toBeVisible();
  await noSeriousViolations(page);

  // 90d includes the old order; previous period is empty so the change shows as a dash
  await page.getByRole("link", { name: "90 días" }).click();
  await expect(tile("Ingresos")).toContainText("$550.00");
  await expect(tile("Pedidos")).toContainText("3");
  await page.getByRole("link", { name: "Este año" }).click();
  await expect(page.getByText("Por semana (inicia el lunes)")).toBeVisible();
});

test("an org with no sales shows empty states; inventory-only hides sales cards", async ({ page }) => {
  await login(page);
  await page.goto(`/o/${orgs.empty.slug}`);
  await expect(page.getByRole("heading", { name: "Sin ventas en este periodo" })).toBeVisible();
  await expect(page.getByText("—").first()).toBeVisible();

  await page.goto(`/o/${orgs.inv.slug}`);
  await expect(page.getByRole("heading", { name: "Productos con stock bajo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Productos más vendidos" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "90 días" })).toHaveCount(0);
});

test("375px has no horizontal scroll and no serious axe violations", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/o/${orgs.full.slug}`);
  await expect(page.getByRole("heading", { name: "Ventas por categoría" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await noSeriousViolations(page);
});
