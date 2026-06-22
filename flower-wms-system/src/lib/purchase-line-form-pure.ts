export type PurchaseLineItemType =
  | "FLOWER"
  | "SUPPLY"
  | "PACKAGING"
  | "TOOL"
  | "OTHER";

export type PurchaseLineFormField =
  | "itemType"
  | "flowerSelect"
  | "purchaseName"
  | "masterPartSelect"
  | "grade"
  | "color"
  | "spec"
  | "purchaseQuantity"
  | "purchaseUnit"
  | "stemsPerUnit"
  | "unitPrice"
  | "usableRate"
  | "note";

export const purchaseLineItemTypeLabels: Record<PurchaseLineItemType, string> = {
  FLOWER: "花材",
  SUPPLY: "辅料",
  PACKAGING: "包装材料",
  TOOL: "工具",
  OTHER: "其他",
};

export const PURCHASE_LINE_ITEM_TYPES: PurchaseLineItemType[] = [
  "FLOWER",
  "SUPPLY",
  "PACKAGING",
  "TOOL",
  "OTHER",
];

export const DEFAULT_PURCHASE_LINE_ITEM_TYPE: PurchaseLineItemType = "FLOWER";

export const DEFAULT_FLOWER_USABLE_RATE_PERCENT = "100";

export function isFlowerPurchaseLineItemType(
  itemType: PurchaseLineItemType
): boolean {
  return itemType === "FLOWER";
}

export function getPurchaseLineVisibleFields(
  itemType: PurchaseLineItemType
): PurchaseLineFormField[] {
  if (isFlowerPurchaseLineItemType(itemType)) {
    return [
      "itemType",
      "flowerSelect",
      "purchaseName",
      "grade",
      "color",
      "purchaseQuantity",
      "purchaseUnit",
      "stemsPerUnit",
      "unitPrice",
      "usableRate",
      "note",
    ];
  }
  return [
    "itemType",
    "masterPartSelect",
    "spec",
    "purchaseQuantity",
    "purchaseUnit",
    "unitPrice",
    "note",
  ];
}

export function getPurchaseLineRequiredFields(
  itemType: PurchaseLineItemType
): PurchaseLineFormField[] {
  if (isFlowerPurchaseLineItemType(itemType)) {
    return [
      "itemType",
      "flowerSelect",
      "purchaseName",
      "purchaseQuantity",
      "purchaseUnit",
      "stemsPerUnit",
      "unitPrice",
      "usableRate",
    ];
  }
  return [
    "itemType",
    "masterPartSelect",
    "purchaseQuantity",
    "purchaseUnit",
    "unitPrice",
  ];
}

export function isPurchaseLineFieldVisible(
  itemType: PurchaseLineItemType,
  field: PurchaseLineFormField
): boolean {
  return getPurchaseLineVisibleFields(itemType).includes(field);
}

export function isPurchaseLineFieldRequired(
  itemType: PurchaseLineItemType,
  field: PurchaseLineFormField
): boolean {
  return getPurchaseLineRequiredFields(itemType).includes(field);
}

export type PurchaseLineDraftDefaults = {
  key: string;
  itemType: PurchaseLineItemType;
  flowerWikiId: string;
  masterPartId: string;
  flowerName: string;
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
};

function createLineKey() {
  return `po-line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultPurchaseLine(
  itemType: PurchaseLineItemType = DEFAULT_PURCHASE_LINE_ITEM_TYPE,
  key = createLineKey()
): PurchaseLineDraftDefaults {
  const isFlower = isFlowerPurchaseLineItemType(itemType);
  return {
    key,
    itemType,
    flowerWikiId: "",
    masterPartId: "",
    flowerName: "",
    purchaseName: "",
    grade: "",
    color: "",
    spec: "",
    purchaseQuantity: "1",
    purchaseUnit: isFlower ? "扎" : "件",
    stemsPerUnit: isFlower ? "10" : "1",
    unitPrice: "0",
    usableRate: isFlower ? DEFAULT_FLOWER_USABLE_RATE_PERCENT : "",
    note: "",
  };
}

export function insertNewPurchaseLineAtTop<T>(lines: T[], newLine: T): T[] {
  return [newLine, ...lines];
}

export function inferPurchaseLineItemTypeFromSavedLine(line: {
  itemType?: string | null;
  masterPartId?: string | null;
  flowerWikiId?: string | null;
  grade?: string | null;
  color?: string | null;
  spec?: string | null;
  usableRate?: string | null;
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

export function parsePurchaseLineItemType(
  raw: unknown
): PurchaseLineItemType | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toUpperCase();
  if (PURCHASE_LINE_ITEM_TYPES.includes(value as PurchaseLineItemType)) {
    return value as PurchaseLineItemType;
  }
  return undefined;
}

export function buildPurchaseLinePayloadLine(line: {
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

export function validatePurchaseLineDraft(
  line: {
    itemType: PurchaseLineItemType;
    flowerWikiId: string;
    masterPartId: string;
    purchaseName: string;
    purchaseQuantity: string;
    purchaseUnit: string;
    stemsPerUnit: string;
    unitPrice: string;
    usableRate: string;
  },
  label: string
): string | null {
  const requiredFields = getPurchaseLineRequiredFields(line.itemType);
  if (requiredFields.includes("flowerSelect") && !line.flowerWikiId.trim()) {
    return `${label}花材明细必须选择花材母表`;
  }
  if (requiredFields.includes("masterPartSelect") && !line.masterPartId.trim()) {
    return `${label}非花材明细必须选择通用物料母表`;
  }
  if (
    requiredFields.includes("purchaseName") &&
    !line.purchaseName.trim()
  ) {
    return `${label}采购名称不能为空`;
  }
  if (!line.purchaseUnit.trim()) {
    return `${label}采购单位不能为空`;
  }
  if (Number(line.purchaseQuantity) <= 0) {
    return `${label}采购数量必须大于 0`;
  }
  if (requiredFields.includes("stemsPerUnit") && Number(line.stemsPerUnit) <= 0) {
    return `${label}每单位支数必须大于 0`;
  }
  if (Number(line.unitPrice) < 0) {
    return `${label}单价不能小于 0`;
  }
  if (requiredFields.includes("usableRate") && !line.usableRate.trim()) {
    return `${label}可用率不能为空`;
  }
  return null;
}

export function isPurchaseLineReadyForPreview(line: {
  itemType: PurchaseLineItemType;
  flowerWikiId: string;
  masterPartId: string;
  purchaseQuantity: string;
  purchaseUnit: string;
  stemsPerUnit: string;
  unitPrice: string;
}): boolean {
  if (!line.purchaseUnit.trim()) return false;
  if (Number(line.purchaseQuantity) <= 0) return false;
  if (Number(line.unitPrice) < 0) return false;
  if (isFlowerPurchaseLineItemType(line.itemType)) {
    return (
      Boolean(line.flowerWikiId.trim()) && Number(line.stemsPerUnit) > 0
    );
  }
  return Boolean(line.masterPartId.trim()) && Number(line.stemsPerUnit) > 0;
}

export const MASTER_PART_SELECT_EMPTY_HINT =
  "请先到 WMS → 库存与采购 → 通用物料母表 维护该物料。";
