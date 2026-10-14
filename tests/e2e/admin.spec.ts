import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// Settings (org + members) and the platform /admin panel in a real browser.
const sql = postgres(process.env.DATABASE_URL_MIGRATE!, { prepare: false, max: 1 });
const run = randomUUID().slice(0, 8);
const PASSWORD = "correct horse battery staple";
const mk = (k: string) => ({ id: randomUUID(), email: `${k}-${run}@test.local` });
const users = { platform: mk("plat"), boss: mk("boss"), worker: mk("work") };
const org = { id: "", slug: `e2e-set-${run}`, name: `Cafetería ${run}` };
const created = { slug: `e2e-new-${run}`, name: `Nueva ${run}`, email: `first-${run}@test.local` };

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
  await sql`insert into platform_admins (user_id) values (${users.platform.id})`;
  [{ id: org.id }] = await sql`insert into organizations (name, slug) values (${org.name}, ${org.slug}) returning id`;
  await sql`insert into memberships (org_id, user_id, role) values (${org.id}, ${users.boss.id}, 'admin'), (${org.id}, ${users.worker.id}, 'member')`;
});

test.afterAll(async () => {
  const ids = await sql`select id from organizations where slug in (${org.slug}, ${created.slug})`;
  for (const { id } of ids) {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.deleting_org', ${id}, true)`;
      await tx`delete from organizations where id = ${id}`;
    });
    await sql`delete from audit_log where org_id = ${id}`;
  }
  const uids = Object.values(users).map((u) => u.id);
  await sql`delete from audit_log where actor_id = any(${uids})`;
  await sql`delete from platform_admins where user_id = any(${uids})`;
  await sql`delete from auth.users where id = any(${uids})`;
  await sql.end();
});

async function login(page: Page, user: { email: string }) {
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
const notFound = (page: Page) => expect(page.getByRole("heading", { name: "No encontramos esa página" })).toBeVisible();

test("org admin: edits the org, invites and revokes, changes roles, keeps one admin", async ({ page }) => {
  await login(page, users.boss);
  await page.goto(`/o/${org.slug}/settings`);
  await expect(page.getByRole("heading", { name: "Miembros" })).toBeVisible();
  await noSeriousViolations(page);

  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill(`${org.name} 2`);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cambios guardados." })).toBeVisible();
  await page.getByRole("combobox", { name: "Moneda (código)" }).fill("ZZZ");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Moneda no válida" })).toBeVisible();

  const invitee = `guest-${run}@test.local`;
  await page.getByRole("textbox", { name: "Correo" }).fill(invitee);
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitación enviada" })).toBeVisible();
  await expect(page.getByText(invitee, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Revocar invitación de ${invitee}` }).click();
  await expect(page.getByText(invitee, { exact: true })).toHaveCount(0);

  // The worker becomes a viewer; the sole admin cannot demote themself
  const workerRow = page.getByRole("listitem").filter({ hasText: users.worker.email });
  await workerRow.getByRole("combobox", { name: "Rol" }).selectOption("viewer");
  await workerRow.getByRole("button", { name: "Guardar" }).click();
  await expect(workerRow.getByRole("status").filter({ hasText: "Rol actualizado." })).toBeVisible();
  const bossRow = page.getByRole("listitem").filter({ hasText: "(tú)" });
  await bossRow.getByRole("combobox", { name: "Rol" }).selectOption("member");
  await bossRow.getByRole("button", { name: "Guardar" }).click();
  await expect(bossRow.getByRole("alert").filter({ hasText: "al menos un administrador" })).toBeVisible();

  await workerRow.getByRole("button", { name: "Quitar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByText(users.worker.email, { exact: true })).toHaveCount(0);
  await sql`insert into memberships (org_id, user_id, role) values (${org.id}, ${users.worker.id}, 'viewer')`;
});

test("non-admin members see the roster only and cannot reach /admin", async ({ page }) => {
  await login(page, users.worker);
  await page.goto(`/o/${org.slug}/settings`);
  await expect(page.getByRole("heading", { name: "Miembros" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organización" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Invitar a alguien" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salir" })).toBeVisible();
  await page.goto("/admin");
  await notFound(page);
});

test("platform admin: creates an org, manages modules, suspends it", async ({ page }) => {
  await login(page, users.platform);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Organizaciones" })).toBeVisible();
  await noSeriousViolations(page);

  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill(created.name);
  await page.getByRole("textbox", { name: "Identificador (URL)" }).fill(created.slug);
  await page.getByRole("textbox", { name: "Correo de su primer administrador" }).fill(created.email);
  await page.getByRole("button", { name: "Crear e invitar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Organización creada." })).toBeVisible();
  // Same identifier again: refused
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill(created.name);
  await page.getByRole("textbox", { name: "Identificador (URL)" }).fill(created.slug);
  await page.getByRole("textbox", { name: "Correo de su primer administrador" }).fill(created.email);
  await page.getByRole("button", { name: "Crear e invitar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ya existe una organización" })).toBeVisible();

  const card = page.getByRole("listitem").filter({ hasText: `/${created.slug}` });
  await card.getByRole("checkbox", { name: "Inventario" }).uncheck();
  await card.getByRole("button", { name: "Guardar módulos" }).click();
  await expect(card.getByRole("alert").filter({ hasText: "Ventas necesita el módulo de Inventario." })).toBeVisible();
  await card.getByRole("checkbox", { name: "Ventas" }).uncheck();
  await card.getByRole("button", { name: "Guardar módulos" }).click();
  await expect(card.getByRole("status").filter({ hasText: "Módulos actualizados." })).toBeVisible();
  const [row] = await sql`select enabled_modules from organizations where slug = ${created.slug}`;
  expect(row.enabled_modules).toEqual([]);

  // Suspending the settings org hides it from its members
  const target = page.getByRole("listitem").filter({ hasText: `/${org.slug}` });
  await target.getByRole("button", { name: "Suspender" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Suspender" }).click();
  await expect(target.getByText("Suspendida")).toBeVisible();
});

test("a suspended org is a 404 for its members", async ({ page }) => {
  await login(page, users.boss);
  await page.goto(`/o/${org.slug}`);
  await notFound(page);
});
