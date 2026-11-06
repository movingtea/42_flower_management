import type { LossReason } from "@/generated/prisma-v2-draft/client";

/** Chinese labels for every LossReason value in the V2 draft schema. */
export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  RECEIPT_REJECTED: "收货拒收",
  CARE_DAMAGE: "护理损伤",
  EXPIRED: "过期",
  PRODUCTION_ERROR: "生产损耗",
  DELIVERY_DAMAGE: "配送损伤",
  STOCKTAKE_DIFFERENCE: "盘点差异",
  OTHER: "其他",
};

/** Order shown in the manual loss form. */
export const LOSS_REASON_OPTIONS: readonly LossReason[] = [
  "CARE_DAMAGE",
  "EXPIRED",
  "PRODUCTION_ERROR",
  "DELIVERY_DAMAGE",
  "RECEIPT_REJECTED",
  "STOCKTAKE_DIFFERENCE",
  "OTHER",
];

export function lossReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "—";
  return reason in LOSS_REASON_LABELS
    ? LOSS_REASON_LABELS[reason as LossReason]
    : reason;
}

export const TRANSACTION_KIND_LABELS: Record<string, string> = {
  INBOUND: "入库",
  TRANSFER: "移库",
  CONSUME: "出库",
  LOSS: "损耗",
  RETURN: "退回",
  ADJUSTMENT: "调整",
  FREEZE: "冻结",
  UNFREEZE: "解冻",
};

export function transactionKindLabel(kind: string): string {
  return TRANSACTION_KIND_LABELS[kind] ?? kind;
}

export const REFERENCE_TYPE_LABELS: Record<string, string> = {
  MANUAL_INBOUND: "手工入库",
  PURCHASE_RECEIPT: "采购验收",
  GOODS_RECEIPT_LINE: "采购验收",
  STOCKTAKE: "盘点确认",
  STOCKTAKE_LINE: "盘点调整",
  INVENTORY_ADJUSTMENT: "库存调整",
  INVENTORY_TRANSFER: "库位移库",
  LOSS_RECORD: "损耗登记",
  PRODUCTION_TASK: "生产领用",
};

export function referenceTypeLabel(type: string): string {
  return REFERENCE_TYPE_LABELS[type] ?? type;
}
