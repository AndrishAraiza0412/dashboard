import { expect, test } from "@playwright/test";

// Read-only checks that need no credentials and create no data.
test.skip(!process.env.SMOKE_URL, "set SMOKE_URL to run against a deployment");

test("health check reports ok and nothing else", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
});

test("signed-out visitors are sent to login, and the design gallery is not public", async ({ page }) => {
  await page.goto("/o/does-not-exist");
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.goto("/design");
  await expect(page.getByRole("heading", { name: "No encontramos esa página" })).toBeVisible();
});

test("security headers are present", async ({ request }) => {
  const h = (await request.get("/login")).headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
});
