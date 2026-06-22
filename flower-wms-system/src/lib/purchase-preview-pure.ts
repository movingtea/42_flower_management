import {
  isFlowerPurchaseLineItemType,
  type PurchaseLineItemType,
} from "@/lib/purchase-line-form-pure";
import {
  assertFlowerHasNoMasterPart,
  assertMasterPartTypeMatchesItemType,
  assertNonFlowerHasNoFlowerWiki,
  normalizeFlowerWikiIdForLine,
  normalizeMasterPartIdForLine,
  parsePurchaseLineItemTypeStrict,
} from "@/lib/purchase-line-source-pure";

export type PurchasePreviewLineInput = {
  itemType?: unknown;
  flowerWikiId?: unknown;
  masterPartId?: unknown;
  purchaseQuantity?: unknown;
  purchaseUnit?: unknown;
  stemsPerUnit?: unknown;
  unitPrice?: unknown;
  usableRate?: unknown;
  purchaseName?: unknown;
  grade?: unknown;
  color?: unknown;
  spec?: unknown;
  note?: unknown;
};

export type ParsedPurchasePreviewLine = {
  itemType: PurchaseLineItemType;
  flowerWikiId: string | null;
  masterPartId: string | null;
};

export function parsePurchasePreviewLine(
  raw: unknown,
  index: number
): ParsedPurchasePreviewLine {
  if (!raw || typeof raw !== "object") {
    throw new Error(`第 ${index + 1} 行采购明细格式不正确`);
  }
  const row = raw as PurchasePreviewLineInput;
  const label = `第 ${index + 1} 行：`;
  const itemType = parsePurchaseLineItemTypeStrict(row.itemType);
  const flowerWikiId = normalizeFlowerWikiIdForLine(row.flowerWikiId, itemType);
  const masterPartId = normalizeMasterPartIdForLine(row.masterPartId, itemType);
  assertNonFlowerHasNoFlowerWiki(
    itemType,
    typeof row.flowerWikiId === "string" ? row.flowerWikiId : null,
    label
  );
  assertFlowerHasNoMasterPart(
    itemType,
    typeof row.masterPartId === "string" ? row.masterPartId : null,
    label
  );
  return { itemType, flowerWikiId, masterPartId };
}

export function collectFlowerWikiIdsForPreview(
  lines: ParsedPurchasePreviewLine[]
): string[] {
  return Array.from(
    new Set(
      lines
        .filter((line) => isFlowerPurchaseLineItemType(line.itemType))
        .map((line) => line.flowerWikiId)
        .filter((id): id is string => Boolean(id))
    )
  );
}

export function collectMasterPartIdsForPreview(
  lines: ParsedPurchasePreviewLine[]
): string[] {
  return Array.from(
    new Set(
      lines
        .filter((line) => !isFlowerPurchaseLineItemType(line.itemType))
        .map((line) => line.masterPartId)
        .filter((id): id is string => Boolean(id))
    )
  );
}

export function assertPreviewMasterPartReferences(input: {
  lines: ParsedPurchasePreviewLine[];
  masterParts: Array<{ id: string; type: string; isActive?: boolean }>;
}): void {
  const masterPartMap = new Map(input.masterParts.map((part) => [part.id, part]));

  input.lines.forEach((line, index) => {
    if (isFlowerPurchaseLineItemType(line.itemType)) return;
    const label = `第 ${index + 1} 行：`;
    if (!line.masterPartId) {
      throw new Error(`${label}非花材明细必须选择通用物料母表`);
    }
    const masterPart = masterPartMap.get(line.masterPartId);
    if (!masterPart) {
      throw new Error(`${label}所选通用物料无效，请重新选择`);
    }
    if (masterPart.isActive === false) {
      throw new Error(`${label}所选通用物料已停用`);
    }
    assertMasterPartTypeMatchesItemType(masterPart.type, line.itemType, label);
  });
}

export function assertPreviewFlowerWikiReferences(input: {
  lines: ParsedPurchasePreviewLine[];
  wikiIds: string[];
}): void {
  const found = new Set(input.wikiIds);
  input.lines.forEach((line, index) => {
    if (!isFlowerPurchaseLineItemType(line.itemType)) return;
    if (!line.flowerWikiId) {
      throw new Error(`第 ${index + 1} 行：花材明细必须选择花材母表`);
    }
    if (!found.has(line.flowerWikiId)) {
      throw new Error(`第 ${index + 1} 行：所选花材无效，请重新选择`);
    }
  });
}
