"use server";
import { redirect } from "next/navigation";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { PurchaseLineRelationKind } from "@/generated/prisma-v2/client";
import { allocatePurchaseDemand } from "@/v2/services/allocate-purchase-demand";
import { cancelPurchaseOrder, createLinkedPurchaseOrder, createPurchaseDraft, createPurchaseSupplementLine, submitPurchaseOrder, updatePurchaseDraft, type PurchaseDraftLine } from "@/v2/services/purchase-order-management";
import { formatQuantity } from "../_lib/purchase-ui";
import { runV2DrawerAction } from "../_lib/action-result";
function text(data: FormData, key: string) { const value = data.get(key); return typeof value === "string" ? value.trim() : ""; }
function number(data: FormData, key: string) { const value = Number(text(data, key) || 0); if (!Number.isFinite(value)) throw new Error(`${key} 必须为数字`); return value; }
function optionalDate(data: FormData, key: string) { const value = text(data, key); if (!value) return undefined; const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error(`${key} 时间无效`); return date; }
function lines(data: FormData): PurchaseDraftLine[] { try { const parsed = JSON.parse(text(data, "lines")); if (!Array.isArray(parsed)) throw new Error(); return parsed.map((line) => ({ materialId: String(line.materialId ?? ""), quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) })); } catch { throw new Error("采购明细格式无效"); } }
function input(data: FormData) { const expectedAt = text(data, "expectedAt"); return { supplierId: text(data, "supplierId"), expectedAt: expectedAt ? new Date(expectedAt) : undefined, freightCost: number(data, "freightCost"), packagingCost: number(data, "packagingCost"), otherCost: number(data, "otherCost"), notes: text(data, "notes"), lines: lines(data) }; }
function purchaseOrdersPath(requirementId?: string) { return requirementId ? `/v2/purchase-orders?requirementId=${encodeURIComponent(requirementId)}` : "/v2/purchase-orders"; }
function appendFeedback(path: string, key: "message" | "error", value: string) { return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`; }
async function run(operation: () => Promise<void>, success: string): Promise<never> { try { await operation(); redirect(`/v2/purchase-orders?message=${encodeURIComponent(success)}`); } catch (cause) { if (cause && typeof cause === "object" && "digest" in cause) throw cause; redirect(`/v2/purchase-orders?error=${encodeURIComponent(cause instanceof Error ? cause.message : "操作失败")}`); } }
async function runAt(path: string, operation: () => Promise<string>, success: string): Promise<never> {
  let message = success;
  try {
    message = (await operation()) || success;
  } catch (cause) {
    if (cause && typeof cause === "object" && "digest" in cause) throw cause;
    redirect(appendFeedback(path, "error", cause instanceof Error ? cause.message : "操作失败"));
  }
  redirect(appendFeedback(path, "message", message));
}
export async function createPurchaseDraftAction(data: FormData) { return runV2DrawerAction(async () => { const scope = await requireV2Store("purchase"); await v2db.$transaction((tx) => createPurchaseDraft(tx, { ...scope, actorStaffId: scope.staffId }, `PO-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`, input(data))); }, "采购草稿已创建"); }
export async function updatePurchaseDraftAction(data: FormData) { return runV2DrawerAction(async () => { const scope = await requireV2Store("purchase"); await v2db.$transaction((tx) => updatePurchaseDraft(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "purchaseOrderId"), input(data))); }, "采购草稿已更新"); }
export async function submitPurchaseOrderAction(data: FormData) { return run(async () => { const scope = await requireV2Store("purchase"); await v2db.$transaction((tx) => submitPurchaseOrder(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "purchaseOrderId"))); }, "采购单已下单"); }
export async function cancelPurchaseOrderAction(data: FormData) { return run(async () => { const scope = await requireV2Store("purchase"); await v2db.$transaction((tx) => cancelPurchaseOrder(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "purchaseOrderId"), text(data, "reason"))); }, "采购单已取消"); }
export async function createPurchaseSupplementAction(data: FormData) {
  return run(async () => {
    const scope = await requireV2Store("purchase");
    const rawKind = text(data, "kind");
    const kind = rawKind === PurchaseLineRelationKind.EXTRA_ORDER
      ? PurchaseLineRelationKind.EXTRA_ORDER
      : rawKind === PurchaseLineRelationKind.REPLACEMENT_DELIVERY
        ? PurchaseLineRelationKind.REPLACEMENT_DELIVERY
        : null;
    if (!kind) throw new Error("关联明细类型无效");
    await v2db.$transaction((tx) => createPurchaseSupplementLine(tx, {
      tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.staffId,
    }, {
      sourceLineId: text(data, "sourceLineId"),
      kind,
      quantity: number(data, "quantity"),
      unitPrice: number(data, "unitPrice"),
      relationKey: text(data, "relationKey"),
    }));
  }, "关联采购明细已创建");
}

/**
 * Creates one formal purchase order for the latest-revision shortage requirement and allocates it
 * in the same transaction. The hidden idempotency key makes a repeated submit reuse the first
 * order instead of creating a duplicate.
 */
export async function createLinkedPurchaseOrderAction(data: FormData): Promise<never> {
  const requirementId = text(data, "requirementId");
  const path = purchaseOrdersPath(requirementId);
  return runAt(path, async () => {
    const scope = await requireV2Store("purchase");
    const result = await v2db.$transaction((tx) => createLinkedPurchaseOrder(tx, {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.staffId,
    }, {
      supplierId: text(data, "supplierId"),
      expectedAt: optionalDate(data, "expectedAt"),
      quantity: number(data, "quantity"),
      unitPrice: number(data, "unitPrice"),
      freightCost: number(data, "freightCost"),
      packagingCost: number(data, "packagingCost"),
      otherCost: number(data, "otherCost"),
      notes: text(data, "notes") || null,
      requirementId,
      allocationQuantity: number(data, "allocationQuantity"),
      idempotencyKey: text(data, "idempotencyKey"),
    }));
    return `${result.number} 已创建并关联缺料需求：分配 ${formatQuantity(result.allocatedQty)}${result.baseUnit}，待关联缺口 ${formatQuantity(result.remainingShortage)}${result.baseUnit}`;
  }, "采购单已创建并关联缺料需求");
}

/** Attributes an existing open purchase line to one latest-revision shortage requirement. */
export async function allocatePurchaseLineAction(data: FormData): Promise<never> {
  const requirementId = text(data, "requirementId");
  return runAt(purchaseOrdersPath(requirementId), async () => {
    const scope = await requireV2Store("purchase");
    const result = await v2db.$transaction((tx) => allocatePurchaseDemand(tx, {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      purchaseLineId: text(data, "purchaseLineId"),
      requirementId,
      quantity: number(data, "quantity"),
      actorStaffId: scope.staffId,
    }));
    const amount = `${formatQuantity(result.allocatedQty)}${result.baseUnit}`;
    if (!result.changed) {
      return `该采购明细已向此需求分配 ${amount}，无需重复操作；待关联缺口 ${formatQuantity(result.requirement.remainingShortage)}${result.baseUnit}`;
    }
    return `已将 ${amount} 从 ${result.purchaseOrderNumber} 分配给缺料需求，待关联缺口 ${formatQuantity(result.requirement.remainingShortage)}${result.baseUnit}`;
  }, "采购需求分配已保存");
}
