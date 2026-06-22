import {
  isFlowerPurchaseLineItemType,
  type PurchaseLineItemType,
} from "@/lib/purchase-line-form-pure";
import { assertMasterPartTypeMatchesItemType } from "@/lib/purchase-line-source-pure";

export type PurchaseReceiveLineRef = {
  itemType?: string | null;
  flowerWikiId?: string | null;
  masterPartId?: string | null;
  purchaseUnit?: string | null;
  purchaseQuantity?: unknown;
  totalStems?: unknown;
  inboundBatchId?: string | null;
  masterPart?: {
    id: string;
    type: string;
    name: string;
    spec?: string | null;
    defaultUnit?: string | null;
    isActive?: boolean;
  } | null;
};

export function resolvePurchaseLineItemTypeForReceive(
  line: PurchaseReceiveLineRef
): PurchaseLineItemType {
  if (
    line.itemType &&
    ["FLOWER", "SUPPLY", "PACKAGING", "TOOL", "OTHER"].includes(line.itemType)
  ) {
    return line.itemType as PurchaseLineItemType;
  }
  if (line.masterPartId) return "OTHER";
  return "FLOWER";
}

export function isFlowerReceiveLine(line: PurchaseReceiveLineRef): boolean {
  return isFlowerPurchaseLineItemType(resolvePurchaseLineItemTypeForReceive(line));
}

export function validateNonFlowerReceiveLine(
  line: PurchaseReceiveLineRef,
  index: number
): void {
  const label = `第 ${index + 1} 行：`;
  const itemType = resolvePurchaseLineItemTypeForReceive(line);
  if (isFlowerPurchaseLineItemType(itemType)) return;

  if (!line.masterPartId?.trim()) {
    throw new Error(`${label}非花材明细必须关联通用物料母表`);
  }
  if (line.flowerWikiId?.trim()) {
    throw new Error(`${label}非花材明细不能关联花材母表`);
  }
  if (!line.masterPart) {
    throw new Error(`${label}通用物料不存在或已停用`);
  }
  if (line.masterPart.isActive === false) {
    throw new Error(`${label}所选通用物料已停用`);
  }
  assertMasterPartTypeMatchesItemType(line.masterPart.type, itemType, label);
  if (line.inboundBatchId) {
    throw new Error(`${label}该明细已入库，不能重复入库`);
  }
}

export function validateFlowerReceiveLine(
  line: PurchaseReceiveLineRef,
  index: number
): void {
  const label = `第 ${index + 1} 行：`;
  if (!line.flowerWikiId?.trim()) {
    throw new Error(`${label}花材明细必须关联花材母表`);
  }
  if (line.inboundBatchId) {
    throw new Error(`${label}该明细已入库，不能重复入库`);
  }
}

export function buildNonFlowerMaterialInput(input: {
  masterPart: {
    id: string;
    name: string;
    spec?: string | null;
    defaultUnit?: string | null;
  };
  purchaseUnit: string;
}): {
  masterPartId: string;
  name: string;
  unit: string;
  wikiId: null;
} {
  const unit =
    input.purchaseUnit.trim() ||
    input.masterPart.defaultUnit?.trim() ||
    "件";
  const spec = input.masterPart.spec?.trim();
  const name = spec
    ? `${input.masterPart.name} ${spec}`.trim()
    : input.masterPart.name.trim();
  return {
    masterPartId: input.masterPart.id,
    name,
    unit,
    wikiId: null,
  };
}

export function parseReceiveQuantityFromDecimal(
  value: { gt: (n: number) => boolean; toNumber: () => number },
  lineLabel: string,
  quantityLabel: string
): number {
  if (!value.gt(0)) {
    throw new Error(`${lineLabel}${quantityLabel}必须大于 0`);
  }
  const n = value.toNumber();
  if (!Number.isInteger(n)) {
    throw new Error(`${lineLabel}${quantityLabel}必须是整数，才能生成库存批次`);
  }
  return n;
}

export function resolveReceiveQuantityLabel(itemType: PurchaseLineItemType): string {
  return isFlowerPurchaseLineItemType(itemType) ? "入库支数" : "入库数量";
}
