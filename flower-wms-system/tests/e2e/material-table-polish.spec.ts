import { expect, test } from "@playwright/test";
import { openRolePage } from "./helpers/auth";
import { createMaterial } from "./helpers/flows";
import { expectFieldWidths, readFieldColumns } from "./helpers/table";
import { expectFeedback, gotoApp } from "./helpers/ui";

/**
 * Focused regression for the material-master table refinements:
 * - column widths come from the rendered field (`col[data-field]`), not one
 *   uniform width; free text keeps ten CJK characters, while the compact
 *   material fields reserve five (`short`) or seven (`medium`) characters;
 * - the row action cell exposes only 查看 / 编辑 / 删除 (cost edits live in 编辑);
 * - enabling/disabling is an accessible, server-confirmed switch and the
 *   default active filter drops a material after it is disabled;
 * - both the flower and the consumable masters opt in to the same layout.
 */



test("花材母表字段列宽、操作与状态开关", async ({ browser }) => {
  const { context, page } = await openRolePage(browser, "admin", "/v2/materials");
  try {
    const marker = `精修-${Date.now()}`;
    const code = await createMaterial(page, { name: marker });

    const row = page.locator("tbody tr").filter({ hasText: code }).first();
    await expect(row).toBeVisible();

    const { fields, headers } = await readFieldColumns(page);
    expect(fields).toEqual([
      "image", "code", "name", "short",
      "short", "medium", "short", "medium",
      "short", "numeric", "status", "action",
    ]);
    expectFieldWidths(fields, headers);

    const actions = row.locator("td").last();
    await expect(actions.getByRole("button")).toHaveText(["查看", "编辑", "删除"]);
    await expect(actions.getByText("停用", { exact: true })).toHaveCount(0);
    await expect(actions.getByText("改成本", { exact: true })).toHaveCount(0);
    await expect(actions.getByText("有业务引用时只能停用")).toHaveCount(0);

    const statusSwitch = row.getByRole("switch");
    await expect(statusSwitch).toHaveAttribute("aria-checked", "true");
    await expect(row.getByText("启用", { exact: true })).toBeVisible();
    await statusSwitch.click();

    await expectFeedback(page, "物料已停用");
    await expect(page.locator("tbody tr").filter({ hasText: code })).toHaveCount(0);

    await gotoApp(page, "/v2/materials?state=all");
    const disabledRow = page.locator("tbody tr").filter({ hasText: code }).first();
    const disabledSwitch = disabledRow.getByRole("switch");
    await expect(disabledSwitch).toHaveAttribute("aria-checked", "false");
    await disabledSwitch.click();

    await expectFeedback(page, "物料已启用");
    await expect(page.locator("tbody tr").filter({ hasText: code }).first()).toBeVisible();
  } finally {
    await context.close();
  }
});

test("耗材母表沿用字段列宽、紧凑操作与状态开关", async ({ browser }) => {
  const { context, page } = await openRolePage(browser, "admin", "/v2/consumables");
  try {
    const marker = `耗材精修-${Date.now()}`;
    const code = await createMaterial(page, { name: marker, kind: "包装" });

    const row = page.locator("tbody tr").filter({ hasText: code }).first();
    await expect(row).toBeVisible();

    const { fields, headers } = await readFieldColumns(page);
    expect(fields).toEqual([
      "image", "code", "name", "short",
      "medium", "medium", "medium", "short",
      "numeric", "numeric", "status", "action",
    ]);
    expectFieldWidths(fields, headers);

    const actions = row.locator("td").last();
    await expect(actions.getByRole("button")).toHaveText(["查看", "编辑", "删除"]);
    await expect(actions.getByText("停用", { exact: true })).toHaveCount(0);
    await expect(actions.getByText("改成本", { exact: true })).toHaveCount(0);
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  } finally {
    await context.close();
  }
});
