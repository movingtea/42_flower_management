import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { seededAccount, type E2ERole } from "./accounts";
import { gotoApp } from "./ui";

/**
 * Role login helper.
 *
 * A successful login is cached as a Playwright storageState file per role for the
 * current run (inside test-results, which Playwright recreates per invocation).
 * The harness gives every run a brand-new database, so the cache is never reused
 * across databases.
 */
const AUTH_DIR = join(process.cwd(), "test-results", ".auth");
const stateFiles = new Map<E2ERole, string>();

export async function expectLoginPage(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "花店 2.0 登录" })).toBeVisible();
}

/**
 * Logs a seeded synthetic account in through the real `/login` form.
 *
 * The first `/api/auth/*` request after a cold `next dev` start can transiently
 * receive the dev server's HTML error document instead of JSON (observed as
 * auth.js `ClientFetchError`), which sends the browser to `/api/auth/error`.
 * A fresh navigation retries the sign-in once the route is compiled; a real
 * credential failure still surfaces as the login form's own alert.
 */
export async function login(page: Page, role: E2ERole): Promise<void> {
  const account = seededAccount(role);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await gotoApp(page, "/login?callbackUrl=/v2");
    await expectLoginPage(page);
    await page.getByLabel("用户名").fill(account.username);
    await page.getByLabel("密码").fill(account.password);
    await page.getByRole("button", { name: "登录" }).click();
    try {
      await page.waitForURL(/\/v2(?:[/?#]|$)/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "经营概览" })).toBeVisible({ timeout: 60_000 });
      // The first /v2 render compiles the route on demand in dev; wait for the
      // client shell used by the module forms before the test navigates further.
      await expect(page.getByRole("link", { name: "首页", exact: true })).toBeVisible();
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("V2 login failed");
}

export async function storageStateFor(browser: Browser, role: E2ERole): Promise<string> {
  const cached = stateFiles.get(role);
  if (cached) return cached;
  const file = join(AUTH_DIR, `${role}.json`);
  if (!existsSync(file)) {
    mkdirSync(AUTH_DIR, { recursive: true });
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await login(page, role);
      await context.storageState({ path: file });
    } finally {
      await context.close();
    }
  }
  stateFiles.set(role, file);
  return file;
}

/**
 * Returns an isolated browser context already authenticated as `role`.
 * Callers own the context and must close it.
 */
export async function openRoleContext(
  browser: Browser,
  role: E2ERole,
): Promise<{ context: BrowserContext; page: Page }> {
  const storageState = await storageStateFor(browser, role);
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  return { context, page };
}

/** Opens an authenticated page and navigates to a V2 route. */
export async function openRolePage(
  browser: Browser,
  role: E2ERole,
  path = "/v2",
): Promise<{ context: BrowserContext; page: Page }> {
  const session = await openRoleContext(browser, role);
  await session.page.goto(path);
  return session;
}
