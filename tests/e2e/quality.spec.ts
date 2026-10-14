import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// AC18 + AC19: every screen has 0 serious/critical axe violations and no horizontal page scroll,
// at desktop width and at 375px. Also: skip link by keyboard, one h1 per page, security headers.
const sql = postgres(process.env.DATABASE_URL_MIGRATE!, { prepare: false, max: 1 });
const run = randomUUID().slice(0, 8);
const PASSWORD = "correct horse battery staple";
const user = { id: randomUUID(), email: `qa-${run}@test.local` };
const org = { id: "", slug: `e2e-qa-${run}`, name: `Calidad ${run}` };
const ids = { product: "", draft: "", confirmed: "" };

test.beforeAll(async () => {
  await sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values (${user.id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${user.email},
            extensions.crypt(${PASSWORD}, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`;
  await sql`insert into platform_admins (user_id) values (${user.id})`;
  [{ id: org.id }] = await sql`insert into organizations (name, slug) values (${org.name}, ${org.slug}) returning id`;
  await sql`insert into memberships (org_id, user_id, role) values (${org.id}, ${user.id}, 'admin')`;
  const [{ id: cat }] = await sql`insert into categories (org_id, name) values (${org.id}, 'Bebidas') returning id`;
  [{ id: ids.product }] = await sql`insert into products (org_id, sku, name, price, stock_qty, reorder_level, category_id) values (${org.id}, 'QA-1', 'Producto de prueba con un nombre bastante largo para forzar el ajuste de línea', 25, 2, 5, ${cat}) returning id`;
  const [{ id: cust }] = await sql`insert into customers (org_id, name, email) values (${org.id}, 'Cliente Prueba', 'cliente@ejemplo.com') returning id`;
  [{ id: ids.draft }] = await sql`insert into orders (org_id, customer_id) values (${org.id}, ${cust}) returning id`;
  await sql`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${org.id}, ${ids.draft}, ${ids.product}, 1, 25)`;
  [{ id: ids.confirmed }] = await sql`insert into orders (org_id, customer_id, status, number, confirmed_at) values (${org.id}, ${cust}, 'confirmed', 1, now()) returning id`;
  await sql`insert into order_items (org_id, order_id, product_id, qty, unit_price) values (${org.id}, ${ids.confirmed}, ${ids.product}, 2, 25)`;
  await sql`insert into stock_movements (org_id, product_id, delta, reason, note) values (${org.id}, ${ids.product}, 4, 'restock', 'Stock inicial')`;
});

test.afterAll(async () => {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.deleting_org', ${org.id}, true)`;
    await tx`delete from organizations where id = ${org.id}`;
  });
  await sql`delete from audit_log where org_id = ${org.id}`;
  await sql`delete from audit_log where actor_id = ${user.id}`;
  await sql`delete from platform_admins where user_id = ${user.id}`;
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

async function audit(page: Page, path: string) {
  const t0 = Date.now();
  await page.goto(path);
  await expect(page.locator("h1").first()).toBeVisible();
  await page.waitForLoadState("load"); // not "networkidle": dev-server streaming keeps it from ever settling on slow runners
  console.log(`audit ${page.viewportSize()?.width}px ${path} ready in ${Date.now() - t0} ms`);
  expect(await page.locator("h1:visible").count(), `${path}: one visible h1`).toBe(1);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `${path}: axe`).toEqual([]);
  const overflow = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth) return [];
    return [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest("[class*=overflow-x-auto]"))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
  });
  expect(overflow, `${path}: horizontal scroll at ${page.viewportSize()?.width}px`).toEqual([]);
}

const PUBLIC = ["/login", "/forgot-password", "/reset-password", "/invite/qa-token"];
const o = `/o/${org.slug}`;
const AUTHED = [
  o, `${o}/inventory`, `${o}/inventory/new`, `${o}/inventory/categories`, `${o}/sales`, `${o}/sales/customers`, `${o}/settings`, "/admin",
];

for (const [label, size] of [["desktop", { width: 1280, height: 800 }], ["375px", { width: 375, height: 800 }]] as const) {
  test(`public screens (${label})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(size);
    for (const path of PUBLIC) await audit(page, path);
  });

  test(`signed-in screens (${label})`, async ({ page }) => {
    test.setTimeout(420_000); // 13 screens in one test; CI runners are slower than a laptop
    await page.setViewportSize(size);
    await login(page);
    for (const path of [...AUTHED, `${o}/inventory/${ids.product}`, `${o}/sales/${ids.draft}`, `${o}/sales/${ids.confirmed}`, "/invite/qa-token", `${o}/inventory?stock=low`]) {
      await audit(page, path);
    }
  });
}

test("keyboard: the skip link is the first stop and jumps to the content", async ({ page }) => {
  await login(page);
  await page.goto(`${o}/inventory`);
  await expect(page.getByRole("heading", { name: "Inventario" })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Saltar al contenido" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  // Every interactive element on the page shows a focus indicator
  const withoutRing = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("main a, main button, main input, main select")) {
      if (!el.offsetParent) continue;
      el.focus({ focusVisible: true } as FocusOptions);
      const s = getComputedStyle(el);
      if (s.outlineStyle === "none" && s.boxShadow === "none") out.push(el.tagName + (el.id ? `#${el.id}` : ""));
    }
    return out;
  });
  expect(withoutRing).toEqual([]);
});

test("responses carry security headers and the health check leaks nothing", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toContain("camera=()");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(await (await request.get("/api/health")).json()).toEqual({ status: "ok" });
});
