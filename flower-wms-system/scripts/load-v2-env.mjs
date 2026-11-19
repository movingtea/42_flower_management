import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

const DEFAULT_MODE = "development";

/**
 * Env files in the same order as Next.js local development, highest priority
 * first: `.env.<mode>.local`, `.env.local`, `.env.<mode>`, `.env`.
 *
 * `.env.local` is kept even when NODE_ENV=test. These are CLI commands rather
 * than the Next.js test runner, and a developer may invoke them from a test
 * shell while still expecting their local V2 connection string. Values already
 * present in the process environment (shell, npm script, CI) always win.
 * Test-specific files still outrank `.env.local` when both exist.
 *
 * @param {string} [mode]
 * @returns {string[]}
 */
export function resolveV2EnvFiles(mode = process.env.NODE_ENV || DEFAULT_MODE) {
  if (mode === "test") {
    return [".env.test.local", ".env.test", ".env.local", ".env"];
  }
  return [
    `.env.${mode}.local`,
    ".env.local",
    `.env.${mode}`,
    ".env",
  ];
}

/**
 * Load the app's env files into `env` using Next.js precedence without
 * overwriting values that were already set. Returns the files that were read,
 * highest priority first.
 *
 * @param {{cwd?: string, mode?: string, env?: NodeJS.ProcessEnv}} [options]
 * @returns {string[]}
 */
export function loadV2Env({
  cwd = process.cwd(),
  mode = process.env.NODE_ENV || DEFAULT_MODE,
  env = process.env,
} = {}) {
  const loadedFiles = [];

  for (const fileName of resolveV2EnvFiles(mode)) {
    const filePath = resolve(cwd, fileName);
    let contents;
    try {
      contents = readFileSync(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    const parsed = parse(contents.replace(/^\uFEFF/, ""));
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined) env[key] = value;
    }
    loadedFiles.push(filePath);
  }

  return loadedFiles;
}
