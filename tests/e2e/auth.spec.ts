import { createHash, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

// Real browser, real Supabase Auth: login, sign-out, org isolation by URL, invitation, a11y, mobile.
const sql = postgres(process.env.DATABASE_URL_MIGRATE!, { prepare: false, max: 1 });
const run = randomUUID().slice(0, 8);
const PASSWORD = "correct horse battery staple";
const TOKEN = `tok-${randomUUID()}`;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const owner = { id: randomUUID(), email: `owner-${run}@test.local` };
const invitee = { id: randomUUID(), email: `invitee-${run}@test.local` };
type Org = { id: string; slug: string; name: string };
const orgs: Record<"mine" | "other" | "joined", Org> = {
  mine: { id: "", slug: `e2e-a-${run}`, name: `Cafe Aurora ${run}` },
  other: { id: "", slug: `e2e-b-${run}`, name: `Otra Org ${run}` },
  joined: { id: "", slug: `e2e-c-${run}`, name: `Taller Norte ${run}` },
};

async function createUser(u: { id: string; email: string }) {
  await sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values (${u.id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${u.email},
            extensions.crypt(${PASSWORD}, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')`;
  // No auth.identities row on purpose: a hand-made one makes GoTrue's password grant fail with
  // "Database error querying schema"; password sign-in works from auth.users alone.
}

test.beforeAll(async () => {
  await createUser(owner);
  await createUser(invitee);
  for (const o of [orgs.mine, orgs.other, orgs.joined]) {
    const rows = await sql`insert into organizations (name, slug) values (${o.name}, ${o.slug}) returning id`;
    o.id = rows[0].id;
  }
  await sql`insert into memberships (org_id, user_id, role) values (${orgs.mine.id}, ${owner.id}, 'admin')`;
  await sql`insert into invitations (org_id, email, role, token_hash) values (${orgs.joined.id}, ${invitee.email}, 'member', ${sha(TOKEN)})`;
});

test.afterAll(async () => {
  for (const o of Object.values(orgs)) {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.deleting_org', ${o.id}, true)`;
      await tx`delete from organizations where id = ${o.id}`;
    });
    await sql`delete from audit_log where org_id = ${o.id}`;
  }
  await sql`delete from audit_log where actor_id in (${owner.id}, ${invitee.id})`;
  await sql`delete from auth.users where id in (${owner.id}, ${invitee.id})`;
  await sql.end();
});

async function login(page: Page, user: { email: string }, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("unauthenticated users are sent to login and keep their destination", async ({ page }) => {
  await page.goto(`/o/${orgs.mine.slug}`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/o/${orgs.mine.slug}`).replaceAll("%", "%")}`));
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
});

test("a wrong password shows one generic error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(owner.email);
  await page.getByLabel("Contraseña").fill("not the password");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Correo o contraseña incorrectos/ })).toBeVisible();
  await page.getByLabel("Correo").fill("nobody@test.local");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Correo o contraseña incorrectos/ })).toBeVisible();
});

test("login lands on the user's organization; other orgs are a 404; sign-out works", async ({ page }) => {
  await login(page, owner);
  await expect(page).toHaveURL(new RegExp(`/o/${orgs.mine.slug}$`));
  await expect(page.getByRole("heading", { name: orgs.mine.name })).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/o/${orgs.mine.slug}$`));

  // Inside Suspense the status line is already sent as 200, so assert on what the user sees.
  // An org that exists but is not theirs and one that does not exist must look identical.
  const notFoundHeading = page.getByRole("heading", { name: "No encontramos esa página" });
  await page.goto(`/o/${orgs.other.slug}`);
  await expect(notFoundHeading).toBeVisible();
  await expect(page.getByText(orgs.mine.name)).toHaveCount(0);
  await page.goto(`/o/does-not-exist-${run}`);
  await expect(notFoundHeading).toBeVisible();

  await page.goto(`/o/${orgs.mine.slug}`);
  await page.getByText(owner.email).click();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/o/${orgs.mine.slug}`);
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("forgot password never reveals whether the email exists", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Correo").fill(`ghost-${run}@test.local`);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Si el correo existe/ })).toBeVisible();
});

test("invitation: signed-out visitors see sign-up; the invited user joins and lands in the org", async ({ page }) => {
  await page.goto(`/invite/${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Crea tu cuenta" })).toBeVisible();

  await login(page, invitee, `/invite/${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Te invitaron a una organización" })).toBeVisible();
  await page.getByRole("button", { name: "Unirme" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${orgs.joined.slug}$`));
  await expect(page.getByRole("heading", { name: orgs.joined.name })).toBeVisible();

  // The token is single-use
  await page.goto(`/invite/${TOKEN}`);
  await page.getByRole("button", { name: "Unirme" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /no es válida, ya se usó o expiró/ })).toBeVisible();
});

test("a user without invitation sees the empty state, not an error", async ({ page }) => {
  const lonely = { id: randomUUID(), email: `lonely-${run}@test.local` };
  await createUser(lonely);
  try {
    await login(page, lonely);
    await expect(page.getByText("Aún no perteneces a ninguna organización")).toBeVisible();
  } finally {
    await sql`delete from auth.users where id = ${lonely.id}`;
  }
});

const secure = async (page: Page) => {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" }); // axe must not sample colors mid-animation
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0].target.join(" ")}`);
};

for (const [name, w] of [["desktop", 1280], ["mobile", 375]] as const) {
  test(`accessibility and layout (${name})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
    const page = await ctx.newPage();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    for (const path of ["/login", "/forgot-password", `/invite/${TOKEN}-unused`]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await secure(page), path).toEqual([]);
      expect(await overflow(), `${path} overflow`).toBe(0);
    }

    await login(page, owner);
    await expect(page.getByRole("heading", { name: orgs.mine.name })).toBeVisible();
    expect(await secure(page), "org home").toEqual([]);
    expect(await overflow(), "org home overflow").toBe(0);
    await ctx.close();
  });
}
