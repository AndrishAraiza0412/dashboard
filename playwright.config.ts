import { config } from "dotenv";
import { defineConfig } from "@playwright/test";

config({ path: ".env.local" });

const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `npx next dev --webpack -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}` },
  },
});
