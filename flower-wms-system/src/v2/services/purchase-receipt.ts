import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { generateBatchNumber } from "@/v2/domain/identifiers";
import { receivePurchaseLine } from "./receive-purchase-line";
import { recheckSupplyAfterReceipt } from "./recheck-supply";
import { rejectPurchaseLine } from "./reject-purchase-line";

/**
 * FormData glue for the two purchase-receiving mutations.
 *
 * It is factored out of the route actions so the purchase-order detail panel
 * and the dedicated receiving page share the same tenant/store checks,
 * idempotency handling and receipt/recheck sequence. Every entry calls
 * `requireV2Store("purchase")` itself; a page render is never the authorization
 * boundary.
 */

function field(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function number(data: FormData, key: string): number {
  const parsed = Number(field(data, key));
  if (!Number.isFinite(parsed)) throw new Error(`${key} 必须为数字`);
  return parsed;
}

function formIdempotencyKey(data: FormData, prefix: string): string {
  return field(data, "idempotencyKey") || `${prefix}-${crypto.randomUUID()}`;
}

/** Receives one purchase line into the store warehouse and rechecks linked demand. */
export async function receivePurchaseFromForm(data: FormData): Promise<string> {
  const { tenantId, storeId, staffId } = await requireV2Store("purchase");
  const location = await v2db.inventoryLocation.findFirst({ where: { storeId, kind: "WAREHOUSE" } });
  if (!location) throw new Error("缺少仓库库位");
  const purchaseLineId = field(data, "purchaseLineId");
  const disposition = field(data, "disposition") === "DOWNGRADED" ? "DOWNGRADED" as const : "ACCEPTED" as const;
  const batchId = await v2db.$transaction(async (tx) => {
    const line = await tx.purchaseOrderLine.findUnique({
      where: { id: purchaseLineId },
      select: {
        materialId: true,
        purchaseOrder: { select: { tenantId: true, storeId: true } },
      },
    });
    if (!line ||
        line.purchaseOrder.tenantId !== tenantId ||
        line.purchaseOrder.storeId !== storeId) {
      throw new Error("采购明细不存在或不属于当前门店");
    }
    return receivePurchaseLine(tx, {
      tenantId,
      actorStaffId: staffId,
      purchaseLineId,
      locationId: location.id,
      // ACCEPTED always receives the ordered material; only a downgrade may name another one.
      acceptedMaterialId: disposition === "ACCEPTED" ? line.materialId : field(data, "acceptedMaterialId"),
      quantity: number(data, "quantity"),
      batchNo: generateBatchNumber(new Date(), crypto.randomUUID()),
      disposition,
      gradeChangeReason: field(data, "gradeChangeReason") || undefined,
      finalUnitCost: number(data, "finalUnitCost"),
      usableUntil: field(data, "usableUntil") ? new Date(field(data, "usableUntil")) : undefined,
      idempotencyKey: formIdempotencyKey(data, "RECEIPT"),
    });
  });
  const batch = await v2db.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } });
  await recheckSupplyAfterReceipt(v2db, tenantId, storeId, batch.materialId, { purchaseLineId });
  return "验收入库完成";
}

/** Records a rejection without increasing on-hand stock. */
export async function rejectPurchaseFromForm(data: FormData): Promise<string> {
  const { tenantId, storeId, staffId } = await requireV2Store("purchase");
  const purchaseLineId = field(data, "purchaseLineId");
  const quantity = number(data, "quantity");
  const result = await v2db.$transaction((tx) => rejectPurchaseLine(tx, {
    tenantId,
    storeId,
    purchaseLineId,
    quantity,
    reason: field(data, "reason"),
    actorStaffId: staffId,
    idempotencyKey: formIdempotencyKey(data, "REJECT"),
  }));
  const line = await v2db.purchaseOrderLine.findUnique({
    where: { id: purchaseLineId },
    select: { material: { select: { baseUnit: true } } },
  });
  const unit = line?.material.baseUnit ?? "";
  const { progress } = result;
  const remaining = progress.remainingQty > 1e-8
    ? `剩余 ${quantityText(progress.remainingQty)}${unit} 待验收，仍可继续验收或拒收`
    : "该采购行已全部处理，不能继续验收";
  return `已拒收 ${quantityText(quantity)}${unit}，累计拒收 ${quantityText(progress.rejectedQty)}${unit}；` +
    `采购单状态：${purchaseStateText(result.purchaseState)}，${remaining}`;
}

function purchaseStateText(state: string): string {
  const labels: Record<string, string> = {
    DRAFT: "草稿",
    ORDERED: "已下单",
    PARTIALLY_RECEIVED: "部分验收",
    RECEIVED: "已收货",
    CANCELLED: "已取消",
    CLOSED: "已关闭",
  };
  return labels[state] ?? state;
}

function quantityText(value: number): string {
  return String(Number(value.toFixed(3)));
}
