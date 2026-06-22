import {
  DEFAULT_PURCHASE_LINE_ITEM_TYPE,
  isFlowerPurchaseLineItemType,
  parsePurchaseLineItemType,
  PURCHASE_LINE_ITEM_TYPES,
  type PurchaseLineItemType,
} from "@/lib/purchase-line-form-pure";

export type MasterPartRef = {
  id: string;
  type: string;
  name: string;
  spec?: string | null;
  defaultUnit?: string | null;
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  isActive?: boolean;
};

export function parsePurchaseLineItemTypeStrict(raw: unknown): PurchaseLineItemType {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_PURCHASE_LINE_ITEM_TYPE;
  }
  const parsed = parsePurchaseLineItemType(raw);
  if (!parsed) {
    throw new Error("采购品类无效，只能为花材、辅料、包装材料、工具或其他");
  }
  return parsed;
}

export function normalizeFlowerWikiIdForLine(
  raw: unknown,
  itemType: PurchaseLineItemType
): string | null {
  if (!isFlowerPurchaseLineItemType(itemType)) {
    return null;
  }
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new Error("花材明细必须选择花材母表");
  }
  return value;
}

export function normalizeMasterPartIdForLine(
  raw: unknown,
  itemType: PurchaseLineItemType
): string | null {
  if (isFlowerPurchaseLineItemType(itemType)) {
    return null;
  }
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new Error("非花材明细必须选择通用物料母表");
  }
  return value;
}

export function assertNonFlowerHasNoFlowerWiki(
  itemType: PurchaseLineItemType,
  flowerWikiId: string | null | undefined,
  label: string
): void {
  if (isFlowerPurchaseLineItemType(itemType)) return;
  if (flowerWikiId?.trim()) {
    throw new Error(`${label}非花材明细不能关联花材母表`);
  }
}

export function assertFlowerHasNoMasterPart(
  itemType: PurchaseLineItemType,
  masterPartId: string | null | undefined,
  label: string
): void {
  if (!isFlowerPurchaseLineItemType(itemType)) return;
  if (masterPartId?.trim()) {
    throw new Error(`${label}花材明细不能关联通用物料母表`);
  }
}

export function assertMasterPartTypeMatchesItemType(
  masterPartType: string,
  itemType: PurchaseLineItemType,
  label: string
): void {
  if (masterPartType !== itemType) {
    throw new Error(`${label}所选通用物料类型与采购品类不一致`);
  }
}

export function resolvePersistedPurchaseLineItemType(line: {
  itemType?: string | null;
  masterPartId?: string | null;
  flowerWikiId?: string | null;
}): PurchaseLineItemType {
  if (
    line.itemType &&
    PURCHASE_LINE_ITEM_TYPES.includes(line.itemType as PurchaseLineItemType)
  ) {
    return line.itemType as PurchaseLineItemType;
  }
  if (line.masterPartId) {
    return "OTHER";
  }
  return DEFAULT_PURCHASE_LINE_ITEM_TYPE;
}

export function resolvePurchaseLineDisplay(line: {
  itemType?: string | null;
  purchaseName?: string | null;
  grade?: string | null;
  color?: string | null;
  spec?: string | null;
  purchaseUnit?: string | null;
  flowerWiki?: { chineseName: string; englishName?: string } | null;
  masterPart?: {
    name: string;
    spec?: string | null;
    type?: string;
    defaultUnit?: string | null;
  } | null;
}): {
  itemType: PurchaseLineItemType;
  displayName: string;
  displaySpec: string | null;
} {
  const itemType = resolvePersistedPurchaseLineItemType(line);
  if (isFlowerPurchaseLineItemType(itemType)) {
    const displayName =
      line.purchaseName?.trim() ||
      line.flowerWiki?.chineseName ||
      "—";
    const specParts = [line.grade, line.color, line.purchaseUnit].filter(
      (part) => Boolean(part?.trim())
    );
    return {
      itemType,
      displayName,
      displaySpec: specParts.length > 0 ? specParts.join(" / ") : null,
    };
  }
  return {
    itemType,
    displayName: line.masterPart?.name || line.purchaseName?.trim() || "—",
    displaySpec: line.masterPart?.spec || line.spec?.trim() || null,
  };
}

export function formatMasterPartOptionLabel(part: {
  name: string;
  spec?: string | null;
  defaultUnit?: string | null;
}): string {
  const segments = [part.name.trim()];
  if (part.spec?.trim()) segments.push(part.spec.trim());
  if (part.defaultUnit?.trim()) segments.push(part.defaultUnit.trim());
  return segments.join(" / ");
}

export function buildPurchaseLineSourcePayload(line: {
  itemType: PurchaseLineItemType;
  flowerWikiId: string;
  masterPartId: string;
  purchaseName: string;
  grade: string;
  color: string;
  spec: string;
  purchaseQuantity: string;
  purchaseUnit: string;
  stemsPerUnit: string;
  unitPrice: string;
  usableRate: string;
  note: string;
}) {
  const isFlower = isFlowerPurchaseLineItemType(line.itemType);
  return {
    itemType: line.itemType,
    flowerWikiId: isFlower ? line.flowerWikiId.trim() || null : null,
    masterPartId: isFlower ? null : line.masterPartId.trim() || null,
    purchaseName: line.purchaseName.trim() || null,
    grade: isFlower ? line.grade.trim() || null : null,
    color: isFlower ? line.color.trim() || null : null,
    spec: isFlower ? null : line.spec.trim() || null,
    purchaseQuantity: line.purchaseQuantity || "0",
    purchaseUnit: line.purchaseUnit,
    stemsPerUnit: isFlower ? line.stemsPerUnit || "0" : line.stemsPerUnit || "1",
    unitPrice: line.unitPrice || "0",
    usableRate: isFlower ? line.usableRate.trim() || null : "100",
    note: line.note.trim() || null,
  };
}
