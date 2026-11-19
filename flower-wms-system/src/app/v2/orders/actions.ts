"use server";

import { redirect } from "next/navigation";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { completeDelivery } from "@/v2/services/complete-delivery";
import { completeProduction, type ActualMaterialUsageInput } from "@/v2/services/complete-production";
import { createManualOrder } from "@/v2/services/manual-order";
import { reviseManualOrder } from "@/v2/services/revise-order";
import {
  cancelOrder as cancelOrderService,
  closeOrder as closeOrderService,
  startOrderProduction as startOrderProductionService,
} from "@/v2/services/order-lifecycle";
import {
  createDeliveryAttempt as createDeliveryAttemptService,
  failDeliveryAttempt as failDeliveryAttemptService,
  rescheduleDeliveryAttempt as rescheduleDeliveryAttemptService,
  startDeliveryAttempt as startDeliveryAttemptService,
} from "@/v2/services/delivery-management";
import { recordDeliveryActualCost as recordDeliveryActualCostService } from "@/v2/services/order-cost-management";

function field(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requiredNumber(data: FormData, key: string, label: string): number {
  const raw = field(data, key);
  if (!raw) throw new Error(`${label}必填`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须为数字`);
  return parsed;
}

function optionalNumber(data: FormData, key: string, fallback = 0): number {
  const raw = field(data, key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${key} 必须为数字`);
  return parsed;
}

function optionalDate(data: FormData, key: string, label: string): Date | undefined {
  const raw = field(data, key);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label}格式无效`);
  return date;
}

function requiredDate(data: FormData, key: string, label: string): Date {
  const date = optionalDate(data, key, label);
  if (!date) throw new Error(`请选择${label}`);
  return date;
}

/** Every order action redirects back to the board with one localized feedback banner. */
async function submit(action: () => Promise<string | void>, success: string): Promise<void> {
  let message = success;
  try {
    message = (await action()) ?? success;
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "操作失败";
    redirect(`/v2/orders?error=${encodeURIComponent(error)}`);
  }
  redirect(`/v2/orders?message=${encodeURIComponent(message)}`);
}

function formIdempotencyKey(data: FormData, prefix: string): string {
  return field(data, "idempotencyKey") || `${prefix}-${crypto.randomUUID()}`;
}

const USAGE_FIELD = /^usage\.([^.]+)\.([^.]+)\.(usedQty|lostQty|returnedQty|reason)$/;
const LEGACY_USAGE_FIELD = /^usage\.([^.]+)\.(usedQty|lostQty|returnedQty|reason)$/;

function usageNumber(
  data: FormData,
  prefix: string,
  key: "usedQty" | "lostQty" | "returnedQty",
  label: string,
): number | undefined {
  const raw = field(data, `${prefix}.${key}`);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须为数字`);
  return parsed;
}

/** Same task+batch contract as the existing V2 production form, scoped by this action. */
function parseActualUsage(data: FormData): ActualMaterialUsageInput[] {
  const rows = new Map<string, { taskId?: string; batchId: string }>();
  const batchesWithTaskKey = new Set<string>();
  for (const key of data.keys()) {
    const match = USAGE_FIELD.exec(key);
    if (!match) continue;
    const [, taskId, batchId] = match;
    rows.set(`${taskId}\u0000${batchId}`, { taskId, batchId });
    batchesWithTaskKey.add(batchId);
  }
  for (const key of data.keys()) {
    const match = LEGACY_USAGE_FIELD.exec(key);
    if (!match) continue;
    const [, batchId] = match;
    if (batchesWithTaskKey.has(batchId)) continue;
    rows.set(`\u0000${batchId}`, { batchId });
  }
  return [...rows.values()]
    .sort((left, right) => left.batchId.localeCompare(right.batchId) ||
      (left.taskId ?? "").localeCompare(right.taskId ?? ""))
    .map(({ taskId, batchId }) => {
      const prefix = taskId ? `usage.${taskId}.${batchId}` : `usage.${batchId}`;
      const usedQty = usageNumber(data, prefix, "usedQty", "实际用量");
      if (usedQty === undefined) throw new Error("实际用量必填");
      const reason = field(data, `${prefix}.reason`);
      return {
        ...(taskId ? { taskId } : {}),
        batchId,
        usedQty,
        lostQty: usageNumber(data, prefix, "lostQty", "损耗数量"),
        returnedQty: usageNumber(data, prefix, "returnedQty", "退料数量"),
        differenceReason: reason || null,
      };
    });
}

export async function createOrder(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("order");
    const itemSkuIds = data.getAll("itemSkuId")
      .map((value) => typeof value === "string" ? value.trim() : "");
    const itemQuantities = data.getAll("itemQuantity")
      .map((value) => typeof value === "string" ? Number(value.trim()) : Number.NaN);
    const common = {
      tenantId,
      storeId,
      actorStaffId: staffId,
      deliveryAt: requiredDate(data, "deliveryAt", "交付时间"),
      buyerName: field(data, "buyerName"),
      fulfillmentKind: field(data, "fulfillmentKind") === "PICKUP" ? "PICKUP" as const : "DELIVERY" as const,
      recipientName: field(data, "recipientName"),
      recipientPhone: field(data, "recipientPhone"),
      address: field(data, "address"),
      deliveryFee: optionalNumber(data, "deliveryFee"),
      estimatedDeliveryCost: optionalNumber(data, "estimatedDeliveryCost"),
    };
    if (itemSkuIds.length > 0 || itemQuantities.length > 0) {
      if (itemSkuIds.length === 0 || itemSkuIds.length !== itemQuantities.length) {
        throw new Error("商品行 SKU 与数量必须一一对应");
      }
      await createManualOrder(v2db, {
        ...common,
        items: itemSkuIds.map((skuId, index) => ({ skuId, quantity: itemQuantities[index] })),
      });
      return;
    }
    await createManualOrder(v2db, {
      ...common,
      skuId: field(data, "skuId"),
      quantity: requiredNumber(data, "quantity", "商品数量"),
    });
  }, "订单草稿已创建");
}

export async function confirmOrder(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("order");
    const { confirmManualOrder } = await import("@/v2/services/manual-order");
    await confirmManualOrder(v2db, field(data, "orderId"), tenantId, storeId, staffId);
  }, "订单已核对供应状态");
}

export async function reviseOrder(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("order");
    const deliveryAtText = field(data, "deliveryAt");
    if (!deliveryAtText) throw new Error("请选择交付时间");
    const itemQuantityKeys = [...data.keys()]
      .filter((key) => key.startsWith("itemQuantity.") && key.length > "itemQuantity.".length);
    const parallelItemIds = data.getAll("orderItemId")
      .map((value) => typeof value === "string" ? value.trim() : "");
    const parallelItemQuantities = data.getAll("itemQuantity")
      .map((value) => typeof value === "string" ? Number(value.trim()) : Number.NaN);
    const deliveryAt = new Date(deliveryAtText);
    if (!Number.isFinite(deliveryAt.getTime())) throw new Error("交付时间格式无效");
    let revisedItems: { orderItemId: string; quantity: number }[] | undefined;
    if (itemQuantityKeys.length > 0) {
      revisedItems = itemQuantityKeys.map((key) => ({
        orderItemId: key.slice("itemQuantity.".length),
        quantity: requiredNumber(data, key, "商品数量"),
      }));
    } else if (parallelItemIds.length > 0 || parallelItemQuantities.length > 0) {
      if (parallelItemIds.length === 0 || parallelItemIds.length !== parallelItemQuantities.length) {
        throw new Error("商品行与数量必须一一对应");
      }
      revisedItems = parallelItemIds.map((orderItemId, index) => ({
        orderItemId,
        quantity: parallelItemQuantities[index],
      }));
    }
    const result = revisedItems
      ? await reviseManualOrder(v2db, {
          tenantId,
          storeId,
          orderId: field(data, "orderId"),
          deliveryAt,
          actorStaffId: staffId,
          items: revisedItems,
        })
      : await reviseManualOrder(v2db, {
          tenantId,
          storeId,
          orderId: field(data, "orderId"),
          quantity: requiredNumber(data, "quantity", "商品数量"),
          deliveryAt,
          actorStaffId: staffId,
        });
    if (result.covered) return `订单已修改为第 ${result.revisionNumber} 版，现货已覆盖，可制作`;
    if (result.totalShortage > 0) return `订单已修改为第 ${result.revisionNumber} 版，仍缺料，待采购`;
    return `订单草稿已更新为第 ${result.revisionNumber} 版，确认后检查供应`;
  }, "订单已修改");
}

export async function cancelOrder(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("order");
    await cancelOrderService(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      actorStaffId: staffId,
      reason: field(data, "reason") || undefined,
    });
  }, "订单已取消");
}

export async function closeOrder(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("order");
    await closeOrderService(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      actorStaffId: staffId,
      reason: field(data, "reason") || undefined,
    });
  }, "订单已关闭");
}

export async function startOrderProduction(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("production");
    await startOrderProductionService(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      actorStaffId: staffId,
    });
  }, "订单已开始制作（不自动分配制作人员）");
}

export async function finishProduction(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("production");
    await completeProduction(v2db, field(data, "orderId"), tenantId, storeId, undefined, staffId);
  }, "制作已完成，库存与成本已结转");
}

export async function finishProductionWithUsage(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("production");
    const actualUsage = parseActualUsage(data);
    if (actualUsage.length === 0) throw new Error("请至少登记一个批次的实际用料");
    await completeProduction(v2db, field(data, "orderId"), tenantId, storeId, actualUsage, staffId);
    return `制作完成，已登记 ${actualUsage.length} 个批次的实际用料`;
  }, "制作完成，实际用料已登记");
}

export async function finishDelivery(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("delivery");
    await completeDelivery(v2db, field(data, "orderId"), tenantId, storeId, staffId);
  }, "交付完成，成本快照已生成");
}

export async function createDeliveryAttempt(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("delivery");
    await createDeliveryAttemptService(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      actorStaffId: staffId,
      scheduledAt: optionalDate(data, "scheduledAt", "预约配送时间"),
      note: field(data, "note") || undefined,
    });
  }, "配送尝试已创建");
}

export async function startDeliveryAttempt(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("delivery");
    await startDeliveryAttemptService(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      attemptId: field(data, "attemptId"),
      actorStaffId: staffId,
    });
  }, "配送已开始");
}

export async function failDeliveryAttempt(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("delivery");
    await failDeliveryAttemptService(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      attemptId: field(data, "attemptId"),
      actorStaffId: staffId,
      reason: field(data, "reason"),
    });
  }, "配送失败已记录");
}

export async function rescheduleDeliveryAttempt(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("delivery");
    await rescheduleDeliveryAttemptService(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      actorStaffId: staffId,
      scheduledAt: requiredDate(data, "scheduledAt", "重排配送时间"),
      note: field(data, "note") || undefined,
    });
  }, "配送已重新安排");
}

export async function recordDeliveryActualCost(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("delivery");
    const amount = requiredNumber(data, "amount", "配送实际成本");
    if (amount < 0) throw new Error("配送实际成本必须为非负数字");
    await recordDeliveryActualCostService(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      actorStaffId: staffId,
      attemptId: field(data, "attemptId") || undefined,
      amount,
      note: field(data, "note") || undefined,
    });
    return `配送实际成本已登记：¥${amount.toFixed(2)}；如已有结账快照将追加成本调整，否则计入下次成本快照`;
  }, "配送实际成本已登记");
}

export async function recordOfflinePayment(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("order");
    const { recordManualPayment } = await import("@/v2/services/record-manual-payment");
    const payment = await recordManualPayment(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      amount: field(data, "amount"),
      method: field(data, "method"),
      externalReference: field(data, "externalReference") || null,
      idempotencyKey: formIdempotencyKey(data, "PAY"),
      confirmedById: staffId,
    });
    return `线下收款已记录：¥${Number(payment.amount).toFixed(2)}`;
  }, "线下收款已记录");
}

export async function recordOfflineRefund(data: FormData): Promise<void> {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("order");
    const { recordRefund } = await import("@/v2/services/record-refund");
    const refund = await recordRefund(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      paymentId: field(data, "paymentId"),
      amount: field(data, "amount"),
      reason: field(data, "reason"),
      externalReference: field(data, "externalReference") || null,
      idempotencyKey: formIdempotencyKey(data, "REFUND"),
      actorStaffId: staffId,
    });
    return `部分退款已记录：¥${Number(refund.amount).toFixed(2)}`;
  }, "部分退款已记录");
}
