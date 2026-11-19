import { expect, test } from "@playwright/test";
import { openRolePage } from "./helpers/auth";
import { createMarker, markerLabel } from "./helpers/marker";
import { createManualInbound, createManualOrder, createMaterial, createProductSkuRecipe, confirmOrderCard, openOrderDrawer } from "./helpers/flows";
import { expectFeedback } from "./helpers/ui";
import { activeReservationQty, batchOnHand, latestBatchForMaterial, materialByCode, orderByBuyer } from "./helpers/db";

/**
 * E11-INV-02 browser case: cancelling a confirmed order releases its reservations
 * exactly once while the batch on-hand quantity stays unchanged.
 */
test.describe("独立用例 · 取消订单释放预留", () => {
  test.setTimeout(360_000);

  test("确认后取消：预留全部释放且批次实存不变", async ({ browser }) => {
    const marker = createMarker("CANCEL");
    let materialCode = "";
    const productName = markerLabel(marker);
    const skuName = `${marker} 单支花束`;
    const buyerName = markerLabel(marker);

    const admin = await openRolePage(browser, "admin", "/v2/materials");
    let skuCode: string;
    try {
      materialCode = await createMaterial(admin.page, {
        name: `${marker} 白玫瑰`,
        kind: "花材",
        color: "白",
        grade: "A",
        baseUnit: "支",
        quantityScale: 0,
      });
      // Supplier is not needed for this case; keep only material + catalog data.
      const created = await createProductSkuRecipe(admin.page, {
        productName,
        skuName,
        price: 88,
        recipeLines: [{ materialCode, quantity: 2 }],
      });
      skuCode = created.skuCode;
      // Manual inbound creates an independent batch with 10 stems on hand.
      await createManualInbound(admin.page, { materialCode, quantity: 10, unitCost: 1.5, reason: "取消预留用例备货" });

      await createManualOrder(admin.page, { buyerName, skuLabel: skuName, quantity: 2, deliveryDays: 3 });
      await confirmOrderCard(admin.page, buyerName);

      const order = await orderByBuyer(buyerName);
      expect(order.commercial_state).toBe("CONFIRMED");
      expect(order.supply_state).toBe("ON_HAND_COVERED");
      expect(await activeReservationQty(order.id)).toBe(4);

      const batch = await latestBatchForMaterial(materialCode);
      expect(await batchOnHand(batch.id)).toBe(10);

      const dialog = await openOrderDrawer(admin.page, buyerName);
      await dialog.getByText("取消订单", { exact: true }).click();
      const cancelForm = dialog
        .locator("form")
        .filter({ has: admin.page.getByRole("button", { name: "确认取消" }) })
        .first();
      await cancelForm.getByLabel("取消原因").fill("顾客取消订单（E2E）");
      await cancelForm.getByRole("button", { name: "确认取消" }).click();
      await expectFeedback(admin.page, "订单已取消");

      const cancelled = await orderByBuyer(buyerName);
      expect(cancelled.commercial_state).toBe("CANCELLED");
      expect(await activeReservationQty(cancelled.id)).toBe(0);
      // Physical stock did not move when the reservation was released.
      expect(await batchOnHand(batch.id)).toBe(10);
      expect((await materialByCode(materialCode)).code).toBe(materialCode);
      expect(skuCode.length).toBeGreaterThan(0);
    } finally {
      await admin.context.close();
    }
  });
});
