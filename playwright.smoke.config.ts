import { defineConfig } from "@playwright/test";

// Post-deploy smoke test against a live URL: SMOKE_URL=https://app.example.com npx playwright test -c playwright.smoke.config.ts
export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 60_000,
  retries: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.SMOKE_URL },
});
