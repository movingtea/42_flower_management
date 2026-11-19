import { expect, test } from "@playwright/test";
import { openRolePage } from "./helpers/auth";
import { createMarker } from "./helpers/marker";
import { createManualInbound, createMaterial } from "./helpers/flows";
import { expectFeedback, gotoApp, selectByText } from "./helpers/ui";
import {
  batchAdjustmentTransactionCount,
  batchOnHand,
  latestBatchForMaterial,
  latestStocktakeForBatch,
} from "./helpers/db";

/**
 * E11-INV-006 browser case (WMS-BR-INV-006): a difference above the store
 * review threshold (default 0) is submitted for review by a non-reviewer, keeps
 * stock unchanged until a manager approves it, and then writes exactly one
 * adjustment.
 */
test.describe("独立用例 · 库存复核与权限（E11-INV-006）", () => {
  test.setTimeout(420_000);

  test("普通员工提交盘点差异进入待复核，经理批准后只调整一次", async ({ browser }) => {
    const marker = createMarker("INV");
    let materialCode = "";
    const stocktakeReason = "护理损耗未登记";

    const admin = await openRolePage(browser, "admin", "/v2/materials");
    try {
      materialCode = await createMaterial(admin.page, {
        name: `${marker} 盘点玫瑰`,
        kind: "花材",
        color: "白",
        grade: "A",
        baseUnit: "支",
        quantityScale: 0,
      });
    } finally {
      await admin.context.close();
    }

    // A purchase-capable buyer receives 10 stems and records a stocktake count of 13.
    const buyer = await openRolePage(browser, "buyer", "/v2/operations");
    try {
      await createManualInbound(buyer.page, { materialCode, quantity: 10, unitCost: 1.5, reason: "盘点用例备货" });
      const batch = await latestBatchForMaterial(materialCode);

      await gotoApp(buyer.page, "/v2/operations");
      const stocktake = buyer.page.locator("#stocktake");
      await selectByText(stocktake.locator('select[name="batchId-0"]'), batch.batch_no);
      await selectByText(stocktake.locator('select[name="locationId-0"]'), "STOCK");
      await stocktake.locator('input[name="countedQty-0"]').fill("13");
      await stocktake.locator('input[name="reason-0"]').fill(stocktakeReason);
      await stocktake.getByRole("button", { name: "创建盘点草稿" }).click();
      await expectFeedback(buyer.page, "盘点草稿已创建");

      // Confirm the draft as a non-reviewer: it becomes a pending review.
      await stocktake.getByRole("button", { name: "确认盘点" }).first().click();
      await expectFeedback(buyer.page, "已提交复核");
      await expect(stocktake.getByText("仅本店经理或库存复核授权人员可处理。").first()).toBeVisible();
      await expect(stocktake.getByRole("button", { name: "复核通过并调整库存" })).toHaveCount(0);

      // Stock is unchanged while the review is pending.
      expect(await batchOnHand(batch.id)).toBe(10);
      expect(await batchAdjustmentTransactionCount(batch.id)).toBe(0);
      const pending = await latestStocktakeForBatch(batch.id);
      expect(pending.state).toBe("PENDING_REVIEW");
    } finally {
      await buyer.context.close();
    }

    // A manager approves the pending review: stock becomes the counted 13 with one adjustment.
    const manager = await openRolePage(browser, "manager", "/v2/operations");
    try {
      const batch = await latestBatchForMaterial(materialCode);
      const stocktake = manager.page.locator("#stocktake");
      await expect(stocktake.getByText("待库存复核").first()).toBeVisible();
      await stocktake.getByPlaceholder("填写复核意见").first().fill("已核对实盘，同意调整");
      await stocktake.getByRole("button", { name: "复核通过并调整库存" }).first().click();
      await expectFeedback(manager.page, "已复核通过并完成库存调整");

      expect(await batchOnHand(batch.id)).toBe(13);
      expect(await batchAdjustmentTransactionCount(batch.id)).toBe(1);
      const confirmed = await latestStocktakeForBatch(batch.id);
      expect(confirmed.state).toBe("CONFIRMED");
      expect(confirmed.review_note).toBe("已核对实盘，同意调整");
    } finally {
      await manager.context.close();
    }
  });
});
