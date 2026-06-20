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
  | "materialName"
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
    "materialName",
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
    "materialName",
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
  flowerWikiId?: string | null;
  grade?: string | null;
  color?: string | null;
  spec?: string | null;
  usableRate?: string | null;
}): PurchaseLineItemType {
  if (line.flowerWikiId) {
    const hasFlowerAttributes =
      Boolean(line.grade?.trim()) ||
      Boolean(line.color?.trim()) ||
      line.usableRate !== null && line.usableRate !== undefined && line.usableRate !== "";
    if (hasFlowerAttributes || !line.spec?.trim()) {
      return "FLOWER";
    }
  }
  if (line.spec?.trim()) {
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
    flowerWikiId: line.flowerWikiId,
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
    return `${label}请选择花材`;
  }
  if (
    requiredFields.includes("materialName") &&
    !line.purchaseName.trim()
  ) {
    return `${label}物料名称不能为空`;
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
  purchaseName: string;
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
  return Boolean(line.purchaseName.trim()) && Number(line.stemsPerUnit) > 0;
}
