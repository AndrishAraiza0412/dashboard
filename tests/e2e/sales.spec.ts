import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// Sales flow in a real browser: customer -> draft order with lines -> confirm (stock drops) -> fulfil / cancel.
const sql = postgres(process.env.DATABASE_URL_MIGRATE!, { prepare: false, max: 1 });
const run = randomUUID().slice(0, 8);
const PASSWORD = "correct horse battery staple";
const org = { id: "", slug: `e2e-sal-${run}`, name: `Ventas ${run}` };
const users = {
  member: { id: randomUUID(), email: `sal-member-${run}@test.local` },
  viewer: { id: randomUUID(), email: `sal-viewer-${run}@test.local` },
};
let productId = "";

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
  [{ id: productId }] = await sql`insert into products (org_id, sku, name, price, stock_qty) values (${org.id}, 'TAZ-1', 'Taza azul', 50, 5) returning id`;
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

const stock = async () => (await sql`select stock_qty from products where id = ${productId}`)[0].stock_qty as number;
// Cache Components keeps earlier pages mounted but hidden, so match only what is on screen.
const badge = (page: Page, text: string) => page.locator("span.rounded-full", { hasText: text }).filter({ visible: true });
const noSeriousViolations = async (page: Page) => {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" }); // axe must not sample colors mid-transition
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
};

test("member: customer -> draft order -> confirm -> fulfil, then cancel returns stock", async ({ page }) => {
  await login(page, users.member);
  await page.getByRole("link", { name: "Ventas" }).click();
  await expect(page.getByRole("heading", { name: "Aún no hay pedidos" })).toBeVisible();
  await noSeriousViolations(page);

  await page.getByRole("link", { name: "Clientes" }).click();
  await page.getByRole("textbox", { name: "Nombre", exact: true }).first().fill("Lucía Pérez");
  await page.getByRole("button", { name: "Añadir cliente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cliente creado." })).toBeVisible();

  await page.goto(`/o/${org.slug}/sales`);
  await page.getByRole("button", { name: "Nuevo pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedido en borrador" })).toBeVisible();

  // Confirming an empty order is refused
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Añade al menos un producto." })).toBeVisible();

  await page.getByRole("combobox", { name: "Cliente" }).selectOption({ label: "Lucía Pérez" });
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardado." })).toBeVisible();

  await page.getByRole("combobox", { name: "Producto" }).selectOption({ label: "Taza azul (5 en stock)" });
  await page.getByRole("spinbutton", { name: "Cantidad" }).last().fill("2");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(page.getByText("SKU TAZ-1")).toBeVisible();
  await expect(page.getByText("$100.00").first()).toBeVisible();

  // Too many units: refused, stock untouched
  await page.getByRole("spinbutton", { name: "Cantidad" }).first().fill("9");
  await page.getByRole("button", { name: "Guardar" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Guardado." }).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Stock insuficiente para Taza azul." })).toBeVisible();
  expect(await stock()).toBe(5);
  await noSeriousViolations(page);

  await page.getByRole("spinbutton", { name: "Cantidad" }).first().fill("2");
  await page.getByRole("button", { name: "Guardar" }).first().click();
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedido #1" })).toBeVisible();
  await expect(badge(page, "Confirmado")).toBeVisible();
  expect(await stock()).toBe(3);

  await page.getByRole("button", { name: "Marcar como completado" }).click();
  await expect(badge(page, "Completado")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar pedido" })).toHaveCount(0);

  // Second order: confirm, then cancel, stock comes back
  await page.goto(`/o/${org.slug}/sales`);
  await page.getByRole("button", { name: "Nuevo pedido" }).click();
  await page.getByRole("combobox", { name: "Producto" }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(page.getByText("SKU TAZ-1")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedido #2" })).toBeVisible();
  expect(await stock()).toBe(2);
  await page.getByRole("button", { name: "Cancelar pedido" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar pedido" }).click();
  await expect(badge(page, "Cancelado")).toBeVisible();
  expect(await stock()).toBe(3);
});

test("viewer reads sales without write controls; 375px has no horizontal scroll", async ({ page }) => {
  await login(page, users.viewer);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/o/${org.slug}/sales`);
  await expect(page.getByRole("link", { name: "#1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nuevo pedido" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await noSeriousViolations(page);
  await page.getByRole("link", { name: "#1" }).click();
  await expect(page.getByRole("button", { name: "Cancelar pedido" })).toHaveCount(0);
  await page.goto(`/o/${org.slug}/sales/customers`);
  await expect(page.getByRole("button", { name: "Añadir cliente" })).toHaveCount(0);
});
