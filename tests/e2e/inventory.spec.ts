import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// Inventory flow in a real browser: create category and product -> adjust stock -> low-stock badge.
const sql = postgres(process.env.DATABASE_URL_MIGRATE!, { prepare: false, max: 1 });
const run = randomUUID().slice(0, 8);
const PASSWORD = "correct horse battery staple";
const org = { id: "", slug: `e2e-inv-${run}`, name: `Inventario ${run}` };
const users = {
  member: { id: randomUUID(), email: `inv-member-${run}@test.local` },
  viewer: { id: randomUUID(), email: `inv-viewer-${run}@test.local` },
};

test.beforeAll(async () => {
  for (const u of Object.values(users)) {
    await sql`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, recovery_token, email_change, email_change_token_new)
      values (${u.id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${u.email},
              extensions.crypt(${PASSWORD}, extensions.gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`;
  }
  [{ id: org.id }] = await sql`insert into organizations (name, slug) values (${org.name}, ${org.slug}) returning id`;
  await sql`insert into memberships (org_id, user_id, role) values (${org.id}, ${users.member.id}, 'member'), (${org.id}, ${users.viewer.id}, 'viewer')`;
});

test.afterAll(async () => {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.deleting_org', ${org.id}, true)`;
    await tx`delete from organizations where id = ${org.id}`;
  });
  await sql`delete from audit_log where org_id = ${org.id}`;
  await sql`delete from audit_log where actor_id in (${users.member.id}, ${users.viewer.id})`;
  await sql`delete from auth.users where id in (${users.member.id}, ${users.viewer.id})`;
  await sql.end();
});

async function login(page: Page, user: { email: string }) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${org.slug}$`));
}

// Cache Components keeps earlier pages mounted but hidden, so match only what is on screen.
const badge = (page: Page, text: string) => page.locator("span.rounded-full", { hasText: text }).filter({ visible: true });

const noSeriousViolations = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
};

test("member: category -> product -> stock adjustments -> low-stock badge", async ({ page }) => {
  await login(page, users.member);
  await page.getByRole("link", { name: "Inventario" }).click();
  await expect(page.getByRole("heading", { name: "Inventario" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aún no hay productos" })).toBeVisible();
  await noSeriousViolations(page);

  await page.getByRole("link", { name: "Categorías" }).click();
  await page.getByRole("textbox", { name: "Nueva categoría" }).fill("Bebidas");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Categoría creada." })).toBeVisible();
  await expect(page.locator('input[id^="cat-"]')).toHaveValue("Bebidas");
  await page.getByRole("textbox", { name: "Nueva categoría" }).fill("Bebidas");
  await page.getByRole("button", { name: "Añadir categoría" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ya existe una categoría" })).toBeVisible();

  await page.goto(`/o/${org.slug}/inventory/new`);
  await page.getByRole("textbox", { name: "SKU", exact: true }).fill("CAF-1");
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill("Café molido");
  await page.getByRole("combobox", { name: "Categoría", exact: true }).selectOption({ label: "Bebidas" });
  await page.getByRole("textbox", { name: "Precio", exact: true }).fill("125.50");
  await page.getByRole("textbox", { name: "Costo", exact: true }).fill("80");
  await page.getByRole("spinbutton", { name: "Avisar con stock ≤" }).fill("5");
  await page.getByRole("button", { name: "Crear producto" }).click();
  await expect(page.getByRole("heading", { name: "Café molido" })).toBeVisible();
  await expect(badge(page, "Agotado")).toBeVisible();

  // Negative stock is refused with a message; the field keeps its value
  await page.getByRole("spinbutton", { name: "Cantidad (+ entra, − sale)" }).fill("-1");
  await page.getByRole("button", { name: "Registrar movimiento" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "negativo" })).toBeVisible();

  await page.getByRole("spinbutton", { name: "Cantidad (+ entra, − sale)" }).fill("3");
  await page.getByRole("textbox", { name: "Nota (opcional)" }).fill("primer lote");
  await page.getByRole("button", { name: "Registrar movimiento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Stock actualizado." })).toBeVisible();
  await expect(page.getByText("SKU CAF-1 · 3 en stock")).toBeVisible();
  await expect(badge(page, "Stock bajo")).toBeVisible();
  await expect(page.getByText("primer lote")).toBeVisible();
  await noSeriousViolations(page);

  // List: search, low-stock filter and the badge
  await page.goto(`/o/${org.slug}/inventory?stock=low&q=caf`);
  await expect(page.getByRole("link", { name: "Café molido" })).toBeVisible();
  await expect(badge(page, "Stock bajo")).toBeVisible();
  await page.goto(`/o/${org.slug}/inventory?q=zzz`);
  await expect(page.getByRole("heading", { name: "Sin resultados" })).toBeVisible();

  // Deactivating keeps the product and the history
  await page.goto(`/o/${org.slug}/inventory`);
  await page.getByRole("link", { name: "Café molido" }).click();
  await page.getByRole("button", { name: "Desactivar" }).click();
  await expect(page.getByRole("button", { name: "Reactivar" })).toBeVisible();
  await expect(badge(page, "Inactivo")).toBeVisible();
});

test("viewer reads inventory but has no write controls; 375px has no horizontal scroll", async ({ page }) => {
  await login(page, users.viewer);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/o/${org.slug}/inventory`);
  await expect(page.getByRole("link", { name: "Café molido" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuevo producto" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await noSeriousViolations(page);

  await page.getByRole("link", { name: "Café molido" }).click();
  await expect(page.getByRole("button", { name: "Registrar movimiento" })).toHaveCount(0);
  await expect(page.getByText("primer lote")).toBeVisible();
  await page.goto(`/o/${org.slug}/inventory/new`);
  await expect(page.getByRole("heading", { name: "No tienes permiso" })).toBeVisible();
});
