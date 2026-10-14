import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The raw DB client bypasses the per-user RLS context; only with-org.ts may use it.
    ignores: ["src/server/db/with-org.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/server/db/client", message: "Use withOrg() from @/server/db/with-org." },
          ],
          patterns: [
            { group: ["**/server/db/client"], message: "Use withOrg() from @/server/db/with-org." },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Installed agent skills and local tooling state, not app code.
    ".agents/**",
    ".claude/**",
    ".omc/**",
    "dashboard/**",
  ]),
]);

export default eslintConfig;
