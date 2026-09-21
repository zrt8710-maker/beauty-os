import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".pnpm-store/**",
    // Installed agent tooling is maintained outside the application's source.
    ".agents/**",
    ".codex/**",
    // Local browser profiles, generated reports and captured bundles are not source.
    ".tmp/**",
    ".playwright-cli/**",
    "output/**",
    "artifacts/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
