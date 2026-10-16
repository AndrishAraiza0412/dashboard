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
  await page.locator("main").first().waitFor(); // the post-login redirect has landed; navigating earlier aborts it
}
const noSeriousViolations = async (page: Page) => {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" }); // axe must not sample colors mid-transition
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
};

test("KPIs, range presets and charts for an org with sales and inventory", async ({ page }) => {
  await login(page);
  await page.goto(`/o/${orgs.full.slug}`);
  const tile = (label: string) => page.locator("[data-tile]", { has: page.getByText(new RegExp(`^${label}$`, "i")) }).filter({ visible: true }).first();

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

test("richer views: comparison, custom range, extra cards and the admin activity feed", async ({ page }) => {
  await login(page);
  await page.goto(`/o/${orgs.full.slug}`);
  for (const heading of ["Pedidos por estado", "Ventas por día de la semana", "Mejores clientes", "Últimos pedidos", "Actividad reciente"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByText("Margen estimado", { exact: true })).toBeVisible();
  await expect(page.getByText("Valor del inventario", { exact: true })).toBeVisible();
  await noSeriousViolations(page);

  // The comparison line is on by default and can be switched off (state lives in the URL)
  const legend = page.getByText("Periodo anterior", { exact: true }).filter({ visible: true });
  await expect(legend).toHaveCount(1);
  await page.getByRole("link", { name: "Ocultar comparación" }).click();
  await expect(page).toHaveURL(/compare=0/);
  await expect(legend).toHaveCount(0);
  await page.getByRole("link", { name: "Comparar con el periodo anterior" }).click();
  await expect(legend).toHaveCount(1);

  // Custom range: the last 3 local days include the 1- and 2-day-old orders but not the 40-day-old one
  const local = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(Date.now() + offset * 86_400_000));
  await page.getByText("Personalizado", { exact: true }).click();
  await page.locator('form input[name="from"]:visible').fill(local(-3));
  await page.locator('form input[name="to"]:visible').fill(local(0));
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/range=custom/);
  const tile = (label: string) => page.locator("[data-tile]", { has: page.getByText(new RegExp(`^${label}$`, "i")) }).filter({ visible: true }).first();
  await expect(tile("Pedidos")).toContainText("2");
  await expect(tile("Ingresos")).toContainText("$500.00");
  // Garbage in the URL falls back to the default period instead of failing
  await page.goto(`/o/${orgs.full.slug}?range=custom&from=nope&to=2026-99-99`);
  await expect(page.getByRole("heading", { name: orgs.full.name })).toBeVisible();
  await expect(tile("Pedidos")).toContainText("2");
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

test("glass style and palettes: toggle persists across reloads, recolors surfaces, no serious axe violations", async ({ page }) => {
  await login(page);
  await page.goto(`/o/${orgs.full.slug}`);
  await page.getByRole("button", { name: "Estilo cristal" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-style", "glass");
  await page.getByLabel("Apariencia").click();
  await page.getByRole("button", { name: "Uva" }).click();
  const canvas = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--wall-1").trim());
  expect(await canvas()).toBe("#4a1f9a");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-style", "glass");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "uva");
  await expect(page.getByRole("button", { name: "Estilo cristal" })).toHaveAttribute("aria-pressed", "true");
  await noSeriousViolations(page);
  if (process.env.SHOTS) {
    for (const theme of ["light", "dark"]) {
      for (const palette of ["coral", "oceano", "bosque", "uva"]) {
        await page.evaluate(([t, p]) => { localStorage.setItem("theme", t); localStorage.setItem("palette", p); }, [theme, palette]);
        await page.reload();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${process.env.SHOTS}/glass-${theme}-${palette}.png`, });
      }
    }
  }
});

test("live: changes made elsewhere and the user's own actions update the page in place, without a reload", async ({ page }) => {
  await login(page);
  await page.goto(`/o/${orgs.full.slug}`);
  const tile = (label: string) => page.locator("[data-tile]", { has: page.getByText(new RegExp(`^${label}$`, "i")) }).filter({ visible: true }).first();
  await expect(tile("Productos activos")).toContainText("2");
  await expect(page.locator("html")).toHaveAttribute("data-live", "on", { timeout: 15_000 });
  await page.evaluate(() => Object.assign(window, { __sameDocument: true })); // lost if the page reloads

  // Someone else (here: straight into the database) adds a product: the KPI follows on its own.
  await sql`insert into products (org_id, sku, name, stock_qty, reorder_level) values (${orgs.full.id}, 'LIVE1', 'Llegó en vivo', 10, 1)`;
  await expect(tile("Productos activos")).toContainText("3", { timeout: 15_000 });
  expect(await page.evaluate(() => (window as { __sameDocument?: boolean }).__sameDocument)).toBe(true);

  // The user's own action: the list updates in place.
  await page.getByRole("link", { name: "Inventario", exact: true }).first().click();
  await expect(page.getByRole("link", { name: "Llegó en vivo" })).toBeVisible();
  await page.goto(`/o/${orgs.full.slug}/inventory/categories`);
  await page.evaluate(() => Object.assign(window, { __sameDocument: true }));
  await page.getByLabel("Nueva categoría").fill("Recién creada");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await expect(page.getByRole("button", { name: "Guardar categoría Recién creada" })).toBeVisible();
  expect(await page.evaluate(() => (window as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
});
