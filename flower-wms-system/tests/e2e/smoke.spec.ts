import { expect, test } from "@playwright/test";
import { expectLoginPage, login, openRoleContext, storageStateFor } from "./helpers/auth";
import { SEEDED_ACCOUNTS, type E2ERole } from "./helpers/accounts";
import { gotoApp } from "./helpers/ui";

test.describe("登录与 V2 基础冒烟", () => {
  test("未登录访问 /v2 会重定向到登录页", async ({ page }) => {
    await page.goto("/v2");
    await page.waitForURL(/\/login/, { timeout: 90_000 });
    await expectLoginPage(page);
    await expect(page).toHaveURL(/callbackUrl=%2Fv2|\?callbackUrl=\/v2/);
  });

  test("错误密码提示错误且不进入工作台", async ({ page }) => {
    await gotoApp(page, "/login?callbackUrl=/v2");
    await expectLoginPage(page);
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("用户名或密码错误");
    await expect(page).toHaveURL(/\/login/);
  });

  test("admin 登录后看到经营概览与全部授权菜单", async ({ page }) => {
    await login(page, "admin");
    await expect(page.getByRole("heading", { name: "经营概览" })).toBeVisible();
    for (const label of ["库存管理", "采购单", "商品与 SKU", "订单履约"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    for (const label of ["物料母表", "供应商", "标准配方", "包装方案", "仓储日常", "员工与权限"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("默认五角色均可登录 V2", async ({ browser }) => {
    for (const role of Object.keys(SEEDED_ACCOUNTS) as E2ERole[]) {
      const { context, page } = await openRoleContext(browser, role);
      try {
        await gotoApp(page, "/v2");
        await expect(page.getByRole("heading", { name: "经营概览" })).toBeVisible({ timeout: 90_000 });
        await expect(page.getByText(`@${SEEDED_ACCOUNTS[role].username}`).first()).toBeVisible();
      } finally {
        await context.close();
      }
    }
  });

  test("storageState 缓存按角色复用", async ({ browser }) => {
    const file = await storageStateFor(browser, "manager");
    await expect(test.info().outputPath()).toBeTruthy();
    const again = await storageStateFor(browser, "manager");
    expect(again).toBe(file);
  });
});
