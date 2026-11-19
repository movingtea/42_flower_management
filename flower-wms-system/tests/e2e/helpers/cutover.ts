import { expect, type Page } from "@playwright/test";
import { expectFeedback, futureDateTimeLocal, gotoApp, selectByText, toggle } from "./ui";
import { dbOne, dbQuery } from "./db";
import { openOrderDrawer } from "./flows";

/**
 * Sprint 3 cutover helpers.
 *
 * flows.ts has no exported helper for the multi-SKU order rows, a standalone
 * purchase draft/submit, offline payment/refund, actual-usage production,
 * pickup handover or cancellation, so those browser interactions live here.
 * The database readers below are read-only assertions that add the projections
 * helpers/db.ts does not expose (per-item usage, payments/refunds, full cost
 * snapshot, batch cost and the movement ledger).
 */

export type MultiSkuOrderInput = {
  buyerName: string;
  items: { skuLabel: string; quantity: number }[];
  deliveryDays?: number;
  fulfillmentKind?: "DELIVERY" | "PICKUP";
  recipient?: { name: string; phone: string; address: string };
};

/**
 * Creates one staff-portal order with several SKU rows through MultiSkuOrderEditor.
 * The editor starts with one row and appends rows with its own "添加商品行" button.
 */
export async function createMultiSkuOrder(page: Page, input: MultiSkuOrderInput): Promise<void> {
  await gotoApp(page, "/v2/orders");
  await toggle(page, "新建后台订单");
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "保存订单草稿" }) })
    .first();
  for (let index = 1; index < input.items.length; index += 1) {
    await form.getByRole("button", { name: "添加商品行" }).click();
  }
  const skuSelects = form.locator('select[name="itemSkuId"]');
  const quantityInputs = form.locator('input[name="itemQuantity"]');
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    await selectByText(skuSelects.nth(index), item.skuLabel);
    await quantityInputs.nth(index).fill(String(item.quantity));
  }
  await form.getByLabel("顾客称呼").fill(input.buyerName);
  await form.getByLabel("交付时间").fill(futureDateTimeLocal(input.deliveryDays ?? 4));
  const kind = input.fulfillmentKind ?? "DELIVERY";
  await form.getByLabel("交付方式").selectOption(kind);
  if (kind === "DELIVERY") {
    const recipient = input.recipient ?? { name: "收货人", phone: "13800000000", address: "上海市测试路 1 号" };
    await form.getByLabel("收件人（配送填写）").fill(recipient.name);
    await form.getByLabel("收件电话（配送填写）").fill(recipient.phone);
    await form.getByLabel("配送地址（配送填写）").fill(recipient.address);
  }
  await form.getByRole("button", { name: "保存订单草稿" }).click();
  await expectFeedback(page, "订单草稿已创建");
}

export type PurchaseDraftInput = {
  supplierCode: string;
  materialCode: string;
  quantity: number;
  unitPrice: number;
  expectedDays?: number;
};

/** Creates one single-line purchase draft through the purchase-orders page. */
export async function createPurchaseDraft(page: Page, input: PurchaseDraftInput): Promise<void> {
  await gotoApp(page, "/v2/purchase-orders");
  await toggle(page, "新建采购单");
  const form = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "创建采购草稿" }) })
    .first();
  await selectByText(form.getByLabel("供应商"), input.supplierCode);
  await form.getByLabel("预计到货时间").fill(futureDateTimeLocal(input.expectedDays ?? 2));
  // The material select has no name attribute; it is the second select after the supplier.
  await selectByText(form.locator("select").nth(1), input.materialCode);
  await form.getByLabel("采购数量").fill(String(input.quantity));
  await form.getByLabel("采购单价").fill(String(input.unitPrice));
  await form.getByRole("button", { name: "创建采购草稿" }).click();
  await expectFeedback(page, "采购草稿已创建");
}

/** Submits a draft purchase order from its detail panel. */
export async function submitPurchaseDraft(page: Page, purchaseOrderNumber: string): Promise<void> {
  await gotoApp(
    page,
    `/v2/purchase-orders?q=${encodeURIComponent(purchaseOrderNumber)}&state=DRAFT`,
  );
  await page
    .locator("tr")
    .filter({ hasText: purchaseOrderNumber })
    .first()
    .getByText("查看详情", { exact: true })
    .click();
  const panel = page.locator("div.fixed").filter({ hasText: purchaseOrderNumber }).first();
  await panel.getByRole("button", { name: "确认下单" }).click();
  await expectFeedback(page, "采购单已下单");
}

/** Records a successful offline payment through the order drawer. */
export async function recordOfflinePayment(
  page: Page,
  orderNeedle: string,
  input: { amount: number; method?: string; externalReference: string },
): Promise<void> {
  const dialog = await openOrderDrawer(page, orderNeedle);
  await toggle(page, "记录线下收款 / 部分退款");
  const form = dialog
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "记录收款" }) })
    .first();
  await form.getByLabel("收款金额").fill(input.amount.toFixed(2));
  await form.locator('select[name="method"]').selectOption(input.method ?? "CASH");
  await form.locator('input[name="externalReference"]').fill(input.externalReference);
  await form.getByRole("button", { name: "记录收款" }).click();
  await expectFeedback(page, `线下收款已记录：¥${input.amount.toFixed(2)}`);
}

/** Records one partial refund against a succeeded payment through the order drawer. */
export async function recordOfflineRefund(
  page: Page,
  orderNeedle: string,
  input: { paymentId: string; amount: number; reason: string; externalReference: string },
): Promise<void> {
  const dialog = await openOrderDrawer(page, orderNeedle);
  await toggle(page, "记录线下收款 / 部分退款");
  const form = dialog
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "记录部分退款" }) })
    .first();
  await form.locator('select[name="paymentId"]').selectOption(input.paymentId);
  await form.getByLabel("退款金额").fill(input.amount.toFixed(2));
  await form.getByLabel("退款原因").fill(input.reason);
  await form.locator('input[name="externalReference"]').fill(input.externalReference);
  await form.getByRole("button", { name: "记录部分退款" }).click();
  await expectFeedback(page, `部分退款已记录：¥${input.amount.toFixed(2)}`);
}

/** Starts production and completes it with per-SKU actual usage / loss rows. */
export async function startProductionAndCompleteWithUsage(
  page: Page,
  orderNeedle: string,
  usages: { itemNeedle: string; usedQty: number; lostQty?: number; reason?: string }[],
): Promise<void> {
  let dialog = await openOrderDrawer(page, orderNeedle);
  await dialog.getByRole("button", { name: "开始制作" }).click();
  await expectFeedback(page, "订单已开始制作");

  dialog = await openOrderDrawer(page, orderNeedle);
  await toggle(page, "登记实际用料（有差异时展开）");
  const form = dialog
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "按实际用料完成制作" }) })
    .first();
  const usedInputs = form.getByLabel("实际用量");
  await expect(usedInputs).toHaveCount(usages.length);
  // The drawer renders one row per task+batch without an explicit order. Match
  // each rendered row to an expected item instead of assuming row order.
  const unmatched = [...usages];
  for (let index = 0; index < usages.length; index += 1) {
    // input -> label -> input grid -> rounded row card (row header holds the item name).
    const row = usedInputs.nth(index).locator("../../..");
    const rowText = await row.innerText();
    const usageIndex = unmatched.findIndex((usage) => rowText.includes(usage.itemNeedle));
    if (usageIndex < 0) throw new Error(`Unexpected production usage row: ${rowText}`);
    const usage = unmatched[usageIndex];
    unmatched.splice(usageIndex, 1);
    await row.getByLabel("实际用量").fill(String(usage.usedQty));
    if (usage.lostQty !== undefined) {
      await row.getByLabel("损耗", { exact: true }).fill(String(usage.lostQty));
    }
    if (usage.reason) {
      await row.getByLabel("差异原因（与预留不一致时必填）").fill(usage.reason);
    }
  }
  if (unmatched.length > 0) {
    throw new Error(`Missing production usage rows for: ${unmatched.map((usage) => usage.itemNeedle).join(", ")}`);
  }
  await form.getByRole("button", { name: "按实际用料完成制作" }).click();
  await expectFeedback(page, `已登记 ${usages.length} 个批次的实际用料`);
}

/** Completes a pickup order and writes the cost snapshot. */
export async function completePickupDelivery(page: Page, orderNeedle: string): Promise<void> {
  const dialog = await openOrderDrawer(page, orderNeedle);
  await dialog.getByRole("button", { name: "交付完成并生成成本快照" }).click();
  await expectFeedback(page, "交付完成，成本快照已生成");
}

/** Cancels a confirmed order from the drawer. */
export async function cancelConfirmedOrder(page: Page, orderNeedle: string, reason: string): Promise<void> {
  const dialog = await openOrderDrawer(page, orderNeedle);
  await dialog.locator("summary").filter({ hasText: "取消订单" }).first().click();
  const form = dialog
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "确认取消" }) })
    .first();
  await form.getByLabel("取消原因").fill(reason);
  await form.getByRole("button", { name: "确认取消" }).click();
  await expectFeedback(page, "订单已取消");
}

/* ------------------------------------------------------------------ */
/* Read-only database assertions                                       */
/* ------------------------------------------------------------------ */

export type OrderItemRow = {
  item_name: string;
  sku_code: string | null;
  quantity: number;
  unit_price: string;
};

export async function orderItemsForOrder(orderId: string): Promise<OrderItemRow[]> {
  return dbQuery<OrderItemRow>(
    `SELECT i."nameSnapshot" AS item_name,
            s.code AS sku_code,
            i.quantity,
            i."unitPrice" AS unit_price
       FROM "OrderItem" i
       LEFT JOIN "ProductSku" s ON s.id = i."skuId"
      WHERE i."orderId" = $1
      ORDER BY s.code NULLS LAST, i."nameSnapshot"`,
    [orderId],
  );
}

export type OrderRequirementRow = {
  item_name: string;
  material_code: string;
  planned_qty: string;
};

export async function orderRequirementsForOrder(orderId: string): Promise<OrderRequirementRow[]> {
  return dbQuery<OrderRequirementRow>(
    `SELECT i."nameSnapshot" AS item_name,
            m.code AS material_code,
            req."plannedQty" AS planned_qty
       FROM "OrderMaterialRequirement" req
       JOIN "OrderItem" i ON i.id = req."orderItemId"
       JOIN "Material" m ON m.id = req."materialId"
      WHERE i."orderId" = $1
      ORDER BY i."nameSnapshot", m.code`,
    [orderId],
  );
}

export type OrderReservationRow = {
  item_name: string;
  batch_id: string;
  batch_no: string;
  quantity: string;
  state: string;
};

export async function orderReservationsForOrder(orderId: string): Promise<OrderReservationRow[]> {
  return dbQuery<OrderReservationRow>(
    `SELECT i."nameSnapshot" AS item_name,
            r."batchId" AS batch_id,
            b."batchNo" AS batch_no,
            r.quantity,
            r.state
       FROM "InventoryReservation" r
       JOIN "OrderMaterialRequirement" req ON req.id = r."requirementId"
       JOIN "OrderItem" i ON i.id = req."orderItemId"
       JOIN "InventoryBatch" b ON b.id = r."batchId"
      WHERE i."orderId" = $1
      ORDER BY i."nameSnapshot", r.state`,
    [orderId],
  );
}

export type ReservationStateTotalRow = { state: string; count: string; quantity: string };

export async function reservationStateTotalsForOrder(orderId: string): Promise<ReservationStateTotalRow[]> {
  return dbQuery<ReservationStateTotalRow>(
    `SELECT r.state,
            COUNT(*)::text AS count,
            COALESCE(SUM(r.quantity), 0) AS quantity
       FROM "InventoryReservation" r
       JOIN "OrderMaterialRequirement" req ON req.id = r."requirementId"
       JOIN "OrderItem" i ON i.id = req."orderItemId"
      WHERE i."orderId" = $1
      GROUP BY r.state
      ORDER BY r.state`,
    [orderId],
  );
}

export type ProductionTaskRow = {
  id: string;
  item_name: string;
  state: string;
  quantity: number;
  started_at: string | null;
  completed_at: string | null;
};

export async function productionTasksForOrder(orderId: string): Promise<ProductionTaskRow[]> {
  return dbQuery<ProductionTaskRow>(
    `SELECT t.id,
            i."nameSnapshot" AS item_name,
            t.state,
            t.quantity,
            t."startedAt" AS started_at,
            t."completedAt" AS completed_at
       FROM "ProductionTask" t
       JOIN "OrderItem" i ON i.id = t."orderItemId"
      WHERE i."orderId" = $1
      ORDER BY i."nameSnapshot"`,
    [orderId],
  );
}

export type MaterialUsageRow = {
  item_name: string;
  material_code: string;
  used_qty: string;
  lost_qty: string;
  returned_qty: string;
  difference_reason: string | null;
};

export async function materialUsageRowsForOrder(orderId: string): Promise<MaterialUsageRow[]> {
  return dbQuery<MaterialUsageRow>(
    `SELECT i."nameSnapshot" AS item_name,
            m.code AS material_code,
            u."usedQty" AS used_qty,
            u."lostQty" AS lost_qty,
            u."returnedQty" AS returned_qty,
            u."differenceReason" AS difference_reason
       FROM "MaterialUsage" u
       JOIN "ProductionTask" t ON t.id = u."taskId"
       JOIN "OrderItem" i ON i.id = t."orderItemId"
       JOIN "InventoryBatch" b ON b.id = u."batchId"
       JOIN "Material" m ON m.id = b."materialId"
      WHERE i."orderId" = $1
      ORDER BY i."nameSnapshot"`,
    [orderId],
  );
}

export type PaymentRow = {
  id: string;
  method: string;
  state: string;
  amount: string;
  external_reference: string | null;
  idempotency_key: string;
};

export async function paymentsForOrder(orderId: string): Promise<PaymentRow[]> {
  return dbQuery<PaymentRow>(
    `SELECT id, method, state, amount,
            "externalReference" AS external_reference,
            "idempotencyKey" AS idempotency_key
       FROM "PaymentTransaction"
      WHERE "orderId" = $1
      ORDER BY "createdAt"`,
    [orderId],
  );
}

export type RefundRow = {
  id: string;
  payment_id: string;
  state: string;
  amount: string;
  reason: string;
  external_reference: string | null;
};

export async function refundsForOrder(orderId: string): Promise<RefundRow[]> {
  return dbQuery<RefundRow>(
    `SELECT id,
            "paymentId" AS payment_id,
            state,
            amount,
            reason,
            "externalReference" AS external_reference
       FROM "RefundTransaction"
      WHERE "orderId" = $1
      ORDER BY "createdAt"`,
    [orderId],
  );
}

export type CostSnapshotRow = {
  revision_no: number;
  revenue: string;
  material_cost: string;
  packaging_cost: string;
  consumable_cost: string;
  labor_cost: string;
  delivery_cost: string;
  platform_cost: string;
  loss_cost: string;
  estimated: boolean;
};

export async function orderCostSnapshotRows(orderId: string): Promise<CostSnapshotRow[]> {
  return dbQuery<CostSnapshotRow>(
    `SELECT "revisionNo" AS revision_no,
            revenue,
            "materialCost" AS material_cost,
            "packagingCost" AS packaging_cost,
            "consumableCost" AS consumable_cost,
            "laborCost" AS labor_cost,
            "deliveryCost" AS delivery_cost,
            "platformCost" AS platform_cost,
            "attributedLossCost" AS loss_cost,
            estimated
       FROM "OrderCostSnapshot"
      WHERE "orderId" = $1
      ORDER BY "revisionNo"`,
    [orderId],
  );
}

export type CostEntryRow = { kind: string; stage: string; amount: string; estimated: boolean };

export async function costEntriesForOrder(orderId: string): Promise<CostEntryRow[]> {
  return dbQuery<CostEntryRow>(
    `SELECT kind, stage, amount, estimated
       FROM "CostEntry"
      WHERE "orderId" = $1
      ORDER BY kind, amount`,
    [orderId],
  );
}

export type BatchDetailRow = {
  id: string;
  batch_no: string;
  unit_cost: string;
  cost_estimated: boolean;
  on_hand: string | null;
  frozen: string | null;
};

export async function batchDetail(batchId: string, locationCode = "STOCK"): Promise<BatchDetailRow> {
  const row = await dbOne<BatchDetailRow>(
    `SELECT b.id,
            b."batchNo" AS batch_no,
            b."unitCost" AS unit_cost,
            b."costEstimated" AS cost_estimated,
            bb."onHandQty" AS on_hand,
            bb."frozenQty" AS frozen
       FROM "InventoryBatch" b
       JOIN "BatchBalance" bb ON bb."batchId" = b.id
       JOIN "InventoryLocation" l ON l.id = bb."locationId"
      WHERE b.id = $1 AND l.code = $2`,
    [batchId, locationCode],
  );
  if (!row) throw new Error(`Batch ${batchId} does not exist at location ${locationCode}`);
  return row;
}

export type TransactionTotalRow = { kind: string; count: string; quantity: string };

export async function inventoryTransactionsForBatch(batchId: string): Promise<TransactionTotalRow[]> {
  return dbQuery<TransactionTotalRow>(
    `SELECT kind,
            COUNT(*)::text AS count,
            COALESCE(SUM(quantity), 0) AS quantity
       FROM "InventoryTransaction"
      WHERE "batchId" = $1
      GROUP BY kind
      ORDER BY kind`,
    [batchId],
  );
}

export type LossRow = { quantity: string; reason: string; note: string | null };

export async function lossRecordsForOrder(orderId: string): Promise<LossRow[]> {
  return dbQuery<LossRow>(
    `SELECT quantity, reason, note
       FROM "LossRecord"
      WHERE "orderId" = $1
      ORDER BY "occurredAt"`,
    [orderId],
  );
}

export type AuditRow = { action: string; after_snapshot: unknown };

/**
 * Order audit events plus the payment/refund events for this order.
 *
 * Payment and refund services record their audit rows on PaymentTransaction /
 * RefundTransaction (entityId is not the order), carrying `orderId` in the
 * snapshot, so filtering by `entityType = 'Order'` alone would miss them.
 */
export async function auditEventsForOrder(orderId: string): Promise<AuditRow[]> {
  return dbQuery<AuditRow>(
    `SELECT action, "afterSnapshot" AS after_snapshot
       FROM "AuditEvent"
      WHERE ("entityType" = 'Order' AND "entityId" = $1)
         OR ("entityType" IN ('PaymentTransaction', 'RefundTransaction')
             AND "afterSnapshot"->>'orderId' = $1)
      ORDER BY "occurredAt"`,
    [orderId],
  );
}
