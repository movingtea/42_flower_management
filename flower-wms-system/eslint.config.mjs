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
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright writes generated reports, traces and screenshots here. They are
    // build artifacts, not source, and must never be linted (minified bundles).
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
    ".playwright/**",
  ]),
]);

export default eslintConfig;
