import { expect, test } from "@playwright/test";
import { openRolePage } from "./helpers/auth";
import { createMarker, markerLabel } from "./helpers/marker";
import {
  confirmOrderCard,
  createManualOrder,
  createMaterial,
  createProductSkuRecipe,
  createSupplier,
  openOrderDrawer,
  receivePurchaseLine,
} from "./helpers/flows";
import { gotoApp } from "./helpers/ui";
import {
  activeReservationQty,
  batchOnHand,
  costAdjustmentsForOrder,
  latestBatchForMaterial,
  latestPurchaseOrderForSupplier,
  materialByCode,
  orderByBuyer,
  parseJson,
  productSkuByProductName,
  publishedRecipeLines,
  purchaseLineProgress,
  totalOnHandForMaterial,
} from "./helpers/db";
import {
  auditEventsForOrder,
  batchDetail,
  cancelConfirmedOrder,
  completePickupDelivery,
  costEntriesForOrder,
  createMultiSkuOrder,
  createPurchaseDraft,
  inventoryTransactionsForBatch,
  lossRecordsForOrder,
  materialUsageRowsForOrder,
  orderCostSnapshotRows,
  orderItemsForOrder,
  orderRequirementsForOrder,
  orderReservationsForOrder,
  paymentsForOrder,
  productionTasksForOrder,
  recordOfflinePayment,
  recordOfflineRefund,
  refundsForOrder,
  reservationStateTotalsForOrder,
  startProductionAndCompleteWithUsage,
  submitPurchaseDraft,
} from "./helpers/cutover";

/**
 * Sprint 3 cutover regression (serial, real browser):
 *
 * purchase and receive stock → one manual order with two SKUs → confirm/reserve
 * from the one received batch → production with per-SKU actual usage and loss →
 * offline payment → partial refund → pickup handover / cost snapshot → data
 * cross-check, then a second confirmed order is cancelled and its reservation is
 * released without touching physical stock or inventory transactions.
 *
 * Every row is created through the UI with a unique run marker, so the spec is
 * repeatable against the harness' fresh seed database. Assertions read the
 * isolated PostgreSQL database, not only page text.
 */
test.describe.serial("Sprint 3 · 多 SKU 退款交付与取消回归", () => {
  const marker = createMarker("S3CUT");
  let roseCode = "";
  let supplierCode = "";
  const productNameA = `${marker} 单支玫瑰`;
  const productNameB = `${marker} 双臂礼盒`;
  const skuNameA = `${marker} 单支规格`;
  const skuNameB = `${marker} 双支规格`;
  const buyerName = markerLabel(marker);
  const cancelBuyerName = `${marker} 取消顾客`;

  const orderTotal = 280;
  const partialRefund = 50;

  let skuCodeA = "";
  let skuCodeB = "";
  let purchaseOrderNumber = "";
  let roseBatchId = "";
  let orderId = "";
  let paymentId = "";

  function auditReason(value: unknown): unknown {
    const parsed = parseJson(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { reason?: unknown }).reason
      : undefined;
  }

  test("准备双 SKU 主数据并通过采购验收入库", async ({ browser }) => {
    test.setTimeout(480_000);
    const { context, page } = await openRolePage(browser, "admin", "/v2/materials");
    try {
      roseCode = await createMaterial(page, {
        name: `${marker} 红玫瑰`,
        kind: "花材",
        color: "红",
        grade: "A",
        baseUnit: "支",
        quantityScale: 0,
      });
      supplierCode = await createSupplier(page, {
        name: `${marker} 花材供应商`,
        contactName: "采购联系人",
        phone: "13900000000",
      });

      // Two independent SKUs (one per product) share the same material, so both
      // requirements will reserve from the single batch received below.
      const createdA = await createProductSkuRecipe(page, {
        productName: productNameA,
        skuName: skuNameA,
        price: 120,
        recipeLines: [{ materialCode: roseCode, quantity: 4 }],
      });
      skuCodeA = createdA.skuCode;
      const createdB = await createProductSkuRecipe(page, {
        productName: productNameB,
        skuName: skuNameB,
        price: 80,
        recipeLines: [{ materialCode: roseCode, quantity: 3 }],
      });
      skuCodeB = createdB.skuCode;

      await createPurchaseDraft(page, {
        supplierCode,
        materialCode: roseCode,
        quantity: 30,
        unitPrice: 2,
        expectedDays: 2,
      });
      const draft = await latestPurchaseOrderForSupplier(supplierCode);
      purchaseOrderNumber = draft.number;
      expect(draft.state).toBe("DRAFT");
      await submitPurchaseDraft(page, purchaseOrderNumber);
      await receivePurchaseLine(page, {
        purchaseOrderNumber,
        quantity: 30,
        finalUnitCost: 2,
      });
    } finally {
      await context.close();
    }

    expect((await materialByCode(roseCode)).code).toBe(roseCode);
    const skuA = await productSkuByProductName(productNameA);
    const skuB = await productSkuByProductName(productNameB);
    expect(skuA.code).toBe(skuCodeA);
    expect(skuB.code).toBe(skuCodeB);
    expect(skuA.code).not.toBe(skuB.code);

    const recipeA = await publishedRecipeLines(skuA.id);
    const recipeB = await publishedRecipeLines(skuB.id);
    expect(recipeA).toHaveLength(1);
    expect(recipeB).toHaveLength(1);
    expect(recipeA[0]?.material_code).toBe(roseCode);
    expect(recipeB[0]?.material_code).toBe(roseCode);
    expect(Number(recipeA[0]?.planned_qty)).toBe(4);
    expect(Number(recipeB[0]?.planned_qty)).toBe(3);

    const purchase = await latestPurchaseOrderForSupplier(supplierCode);
    expect(purchase.number).toBe(purchaseOrderNumber);
    expect(purchase.state).toBe("RECEIVED");
    const progress = await purchaseLineProgress(purchaseOrderNumber);
    expect(progress).toHaveLength(1);
    expect(Number(progress[0]?.accepted)).toBe(30);
    expect(Number(progress[0]?.rejected)).toBe(0);

    const batch = await latestBatchForMaterial(roseCode);
    roseBatchId = batch.id;
    const detail = await batchDetail(batch.id);
    expect(Number(detail.unit_cost)).toBe(2);
    expect(detail.cost_estimated).toBe(false);
    expect(Number(detail.on_hand)).toBe(30);
    expect(await totalOnHandForMaterial(roseCode)).toBe(30);
  });

  test("同一订单两个 SKU：确认后预留共享同一批次且不重复占用库存", async ({ browser }) => {
    test.setTimeout(360_000);
    const { context, page } = await openRolePage(browser, "admin", "/v2/orders");
    try {
      await createMultiSkuOrder(page, {
        buyerName,
        items: [
          { skuLabel: skuNameA, quantity: 1 },
          { skuLabel: skuNameB, quantity: 2 },
        ],
        fulfillmentKind: "PICKUP",
        deliveryDays: 4,
      });

      const draft = await orderByBuyer(buyerName);
      orderId = draft.id;
      expect(draft.commercial_state).toBe("DRAFT");
      expect(await orderItemsForOrder(orderId)).toHaveLength(2);

      // The create action redirects without the query, so re-apply it before
      // acting on the card; this keeps the test independent of other specs' orders.
      await gotoApp(page, `/v2/orders?q=${encodeURIComponent(buyerName)}`);
      await confirmOrderCard(page, buyerName);
    } finally {
      await context.close();
    }

    const order = await orderByBuyer(buyerName);
    expect(order.commercial_state).toBe("CONFIRMED");
    expect(order.supply_state).toBe("ON_HAND_COVERED");
    expect(order.production_state).toBe("READY");

    const items = await orderItemsForOrder(orderId);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.sku_code).sort()).toEqual([skuCodeA, skuCodeB].sort());
    const itemA = items.find((item) => item.sku_code === skuCodeA);
    const itemB = items.find((item) => item.sku_code === skuCodeB);
    expect(itemA?.quantity).toBe(1);
    expect(itemB?.quantity).toBe(2);
    expect(Number(itemA?.unit_price)).toBe(120);
    expect(Number(itemB?.unit_price)).toBe(80);

    const requirements = await orderRequirementsForOrder(orderId);
    expect(requirements).toHaveLength(2);
    expect(requirements.every((row) => row.material_code === roseCode)).toBe(true);
    const requirementA = requirements.find((row) => row.item_name.includes(productNameA));
    const requirementB = requirements.find((row) => row.item_name.includes(productNameB));
    expect(Number(requirementA?.planned_qty)).toBe(4);
    expect(Number(requirementB?.planned_qty)).toBe(6);

    // Both requirements reserve from the same received batch; the physical batch
    // balance must not move when the reservation is created.
    const reservations = await orderReservationsForOrder(orderId);
    expect(reservations).toHaveLength(2);
    expect(reservations.every((row) => row.batch_id === roseBatchId)).toBe(true);
    expect(reservations.every((row) => row.state === "ACTIVE")).toBe(true);
    expect(reservations.reduce((sum, row) => sum + Number(row.quantity), 0)).toBe(10);
    expect(new Set(reservations.map((row) => row.batch_no)).size).toBe(1);
    expect(await activeReservationQty(orderId)).toBe(10);
    expect(await batchOnHand(roseBatchId)).toBe(30);

    const tasks = await productionTasksForOrder(orderId);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.state === "READY")).toBe(true);
  });

  test("制作完成：两个 SKU 分别结转实际用量与损耗", async ({ browser }) => {
    test.setTimeout(360_000);
    const { context, page } = await openRolePage(browser, "admin", "/v2/orders");
    try {
      await startProductionAndCompleteWithUsage(page, buyerName, [
        { itemNeedle: productNameA, usedQty: 4, lostQty: 0 },
        { itemNeedle: productNameB, usedQty: 5, lostQty: 1, reason: "修剪损耗" },
      ]);
    } finally {
      await context.close();
    }

    const order = await orderByBuyer(buyerName);
    expect(order.commercial_state).toBe("CONFIRMED");
    expect(order.production_state).toBe("COMPLETED");
    expect(order.fulfillment_state).toBe("WAITING_PICKUP");
    expect(await activeReservationQty(orderId)).toBe(0);

    const usages = await materialUsageRowsForOrder(orderId);
    expect(usages).toHaveLength(2);
    const usageA = usages.find((row) => row.item_name.includes(productNameA));
    const usageB = usages.find((row) => row.item_name.includes(productNameB));
    expect(Number(usageA?.used_qty)).toBe(4);
    expect(Number(usageA?.lost_qty)).toBe(0);
    expect(Number(usageA?.returned_qty)).toBe(0);
    expect(usageA?.difference_reason).toBeNull();
    expect(Number(usageB?.used_qty)).toBe(5);
    expect(Number(usageB?.lost_qty)).toBe(1);
    expect(Number(usageB?.returned_qty)).toBe(0);
    expect(usageB?.difference_reason).toBe("修剪损耗");

    const reservations = await orderReservationsForOrder(orderId);
    expect(reservations).toHaveLength(2);
    expect(reservations.every((row) => row.state === "CONSUMED")).toBe(true);

    // 30 received - (4 used + 5 used + 1 lost) = 20 stems remain on hand.
    const detail = await batchDetail(roseBatchId);
    expect(Number(detail.on_hand)).toBe(20);
    expect(await batchOnHand(roseBatchId)).toBe(20);
    expect(await totalOnHandForMaterial(roseCode)).toBe(20);

    const transactions = await inventoryTransactionsForBatch(roseBatchId);
    const consumed = transactions.find((row) => row.kind === "CONSUME");
    const transferred = transactions.find((row) => row.kind === "TRANSFER");
    expect(Number(consumed?.count)).toBe(2);
    expect(Number(consumed?.quantity)).toBe(10);
    expect(Number(transferred?.count)).toBe(2);
    expect(Number(transferred?.quantity)).toBe(10);

    const losses = await lossRecordsForOrder(orderId);
    expect(losses).toHaveLength(1);
    expect(Number(losses[0]?.quantity)).toBe(1);
    expect(losses[0]?.reason).toBe("PRODUCTION_ERROR");
    expect(losses[0]?.note).toBe("修剪损耗");

    const entries = await costEntriesForOrder(orderId);
    const materialEntries = entries.filter((entry) => entry.kind === "MATERIAL" && entry.stage === "ACTUAL");
    const lossEntries = entries.filter((entry) => entry.kind === "LOSS" && entry.stage === "ACTUAL");
    expect(materialEntries).toHaveLength(2);
    expect(materialEntries.reduce((sum, entry) => sum + Number(entry.amount), 0)).toBe(18);
    expect(lossEntries).toHaveLength(1);
    expect(Number(lossEntries[0]?.amount)).toBe(2);

    const tasks = await productionTasksForOrder(orderId);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.state === "COMPLETED")).toBe(true);
    expect(tasks.every((task) => task.started_at !== null && task.completed_at !== null)).toBe(true);
  });

  test("线下收款与部分退款后交付：退款单独记账且不改写成本快照", async ({ browser }) => {
    test.setTimeout(420_000);
    const { context, page } = await openRolePage(browser, "admin", "/v2/orders");
    try {
      await recordOfflinePayment(page, buyerName, {
        amount: orderTotal,
        method: "CASH",
        externalReference: `收据-${marker}`,
      });

      const payments = await paymentsForOrder(orderId);
      expect(payments).toHaveLength(1);
      paymentId = payments[0].id;
      expect(payments[0].state).toBe("SUCCEEDED");
      expect(payments[0].method).toBe("CASH");
      expect(Number(payments[0].amount)).toBe(orderTotal);
      expect(payments[0].external_reference).toBe(`收据-${marker}`);
      expect(payments[0].idempotency_key.length).toBeGreaterThan(0);

      await recordOfflineRefund(page, buyerName, {
        paymentId,
        amount: partialRefund,
        reason: "顾客减项，退回部分款项",
        externalReference: `退款-${marker}`,
      });

      const refunds = await refundsForOrder(orderId);
      expect(refunds).toHaveLength(1);
      expect(refunds[0].payment_id).toBe(paymentId);
      expect(refunds[0].state).toBe("SUCCEEDED");
      expect(Number(refunds[0].amount)).toBe(partialRefund);
      expect(refunds[0].reason).toBe("顾客减项，退回部分款项");
      expect(refunds[0].external_reference).toBe(`退款-${marker}`);

      // The original payment row is never rewritten by the refund.
      const paymentsAfterRefund = await paymentsForOrder(orderId);
      expect(paymentsAfterRefund).toHaveLength(1);
      expect(Number(paymentsAfterRefund[0].amount)).toBe(orderTotal);
      expect(paymentsAfterRefund[0].state).toBe("SUCCEEDED");

      await completePickupDelivery(page, buyerName);

      const dialog = await openOrderDrawer(page, buyerName);
      await expect(dialog.getByText("已退款 ¥50.00", { exact: false }).first()).toBeVisible();
      await expect(dialog.getByText("最新快照第 1 版", { exact: false }).first()).toBeVisible();
    } finally {
      await context.close();
    }

    const order = await orderByBuyer(buyerName);
    expect(order.commercial_state).toBe("CONFIRMED");
    expect(order.production_state).toBe("COMPLETED");
    expect(order.fulfillment_state).toBe("DELIVERED");

    // Refunds are separate transactions: the handover snapshot keeps the original
    // order revenue and the actual production cost.
    const snapshots = await orderCostSnapshotRows(orderId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].revision_no).toBe(1);
    expect(Number(snapshots[0].revenue)).toBe(orderTotal);
    expect(Number(snapshots[0].material_cost)).toBe(18);
    expect(Number(snapshots[0].loss_cost)).toBe(2);
    expect(Number(snapshots[0].delivery_cost)).toBe(0);
    expect(await costAdjustmentsForOrder(orderId)).toHaveLength(0);

    const refunds = await refundsForOrder(orderId);
    expect(refunds).toHaveLength(1);
    expect(Number(refunds[0].amount)).toBe(partialRefund);
    expect(refunds[0].payment_id).toBe(paymentId);

    const audits = await auditEventsForOrder(orderId);
    for (const action of [
      "ORDER_CONFIRMED",
      "PRODUCTION_COMPLETED",
      "PAYMENT_RECORDED",
      "REFUND_RECORDED",
      "DELIVERY_COMPLETED",
    ]) {
      expect(audits.filter((audit) => audit.action === action)).toHaveLength(1);
    }
  });

  test("已确认订单取消：预留释放，批次实存与库存流水不变", async ({ browser }) => {
    test.setTimeout(360_000);
    const { context, page } = await openRolePage(browser, "admin", "/v2/orders");
    try {
      await createManualOrder(page, {
        buyerName: cancelBuyerName,
        skuLabel: skuNameA,
        quantity: 2,
        fulfillmentKind: "PICKUP",
        deliveryDays: 5,
      });
      const draft = await orderByBuyer(cancelBuyerName);
      expect(draft.commercial_state).toBe("DRAFT");

      await gotoApp(page, `/v2/orders?q=${encodeURIComponent(cancelBuyerName)}`);
      await confirmOrderCard(page, cancelBuyerName);
    } finally {
      await context.close();
    }

    const confirmed = await orderByBuyer(cancelBuyerName);
    expect(confirmed.commercial_state).toBe("CONFIRMED");
    expect(confirmed.supply_state).toBe("ON_HAND_COVERED");
    // 2 x 4 stems reserved from the same batch, physical stock untouched.
    expect(await activeReservationQty(confirmed.id)).toBe(8);
    expect(await batchOnHand(roseBatchId)).toBe(20);
    const transactionsBeforeCancel = await inventoryTransactionsForBatch(roseBatchId);

    const cancelReason = "顾客临时取消（E2E 取消分支）";
    const second = await openRolePage(browser, "admin", "/v2/orders");
    try {
      await cancelConfirmedOrder(second.page, cancelBuyerName, cancelReason);
    } finally {
      await second.context.close();
    }

    const cancelled = await orderByBuyer(cancelBuyerName);
    expect(cancelled.commercial_state).toBe("CANCELLED");
    expect(await activeReservationQty(cancelled.id)).toBe(0);

    const totals = await reservationStateTotalsForOrder(cancelled.id);
    expect(totals.find((row) => row.state === "ACTIVE")).toBeUndefined();
    const released = totals.find((row) => row.state === "RELEASED");
    expect(Number(released?.count)).toBe(1);
    expect(Number(released?.quantity)).toBe(8);

    // Cancelling releases the reservation only; neither physical stock nor the
    // inventory ledger may move.
    expect(await batchOnHand(roseBatchId)).toBe(20);
    expect(await totalOnHandForMaterial(roseCode)).toBe(20);
    expect(await inventoryTransactionsForBatch(roseBatchId)).toEqual(transactionsBeforeCancel);

    const audits = await auditEventsForOrder(cancelled.id);
    const cancelAudits = audits.filter((audit) => audit.action === "ORDER_CANCELLED");
    expect(cancelAudits).toHaveLength(1);
    expect(auditReason(cancelAudits[0]?.after_snapshot)).toBe(cancelReason);

    // The delivered refund order remains intact.
    const delivered = await orderByBuyer(buyerName);
    expect(delivered.fulfillment_state).toBe("DELIVERED");
    expect(await refundsForOrder(delivered.id)).toHaveLength(1);
    expect(await orderCostSnapshotRows(delivered.id)).toHaveLength(1);
  });
});
