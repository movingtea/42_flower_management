import { expect, test } from "@playwright/test";
import { openRolePage } from "./helpers/auth";
import { createManualInbound, createMaterial, createSupplier } from "./helpers/flows";
import { expectFieldWidths, readFieldColumns } from "./helpers/table";
import { gotoApp } from "./helpers/ui";

/**
 * Rollout regression for the non-material business lists. Both pages are
 * populated through their real forms so the assertions do not depend on an
 * optional seed tier.
 */
test("供应商与库存列表使用字段列宽与粘性操作列", async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await openRolePage(browser, "admin", "/v2/suppliers");
  try {
    const marker = Date.now();
    await createSupplier(page, { name: `列表供应商-${marker}`, contactName: "列表联系人" });

    const supplierTable = page.locator("main table").first();
    await expect(supplierTable).toBeVisible();
    const supplierColumns = await readFieldColumns(page, supplierTable);
    expect(supplierColumns.fields).toEqual(["code", "name", "text", "text", "status", "action"]);
    expectFieldWidths(supplierColumns.fields, supplierColumns.headers);

    const materialCode = await createMaterial(page, {
      name: `列表耗材-${marker}`,
      kind: "耗材",
      baseUnit: "个",
    });
    await createManualInbound(page, { materialCode, quantity: 5, unitCost: 1.5 });
    await gotoApp(page, "/v2/inventory");

    const inventoryTable = page.locator("main table").first();
    await expect(inventoryTable).toBeVisible();
    const inventoryColumns = await readFieldColumns(page, inventoryTable);
    expect(inventoryColumns.fields).toEqual([
      "name", "text", "numeric", "numeric", "numeric",
      "numeric", "numeric", "status", "action",
    ]);
    expectFieldWidths(inventoryColumns.fields, inventoryColumns.headers);
    await expect(inventoryTable.locator("tbody tr").filter({ hasText: materialCode })).toHaveCount(1);
  } finally {
    await context.close();
  }
});
