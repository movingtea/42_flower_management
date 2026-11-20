/**
 * Pure label formatting for material pickers in the samples editor.
 *
 * The submitted value stays the material id; this helper only decides what
 * staff read in the closed select and its option list. It deliberately omits
 * the material code, avoids repeating a classification part already present in
 * an auto-generated name, and adds an available descriptor when two materials
 * share the same name.
 */
export type MaterialOptionLabelInput = {
  name: string;
  kind: string;
  baseUnit: string;
  availableQty: number;
  standardUnitCost: number | null;
  active: boolean;
  flowerVariety?: string | null;
  flowerProductName?: string | null;
  color?: string | null;
};

const KIND_LABEL: Record<string, string> = {
  FLOWER: "花材",
  FOLIAGE: "叶材",
  PACKAGING: "包装",
  CONSUMABLE: "耗材",
  OTHER: "其他",
};

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase("zh-CN");
}

function classificationParts(material: MaterialOptionLabelInput): string[] {
  return [material.flowerVariety, material.color, material.flowerProductName]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean);
}

/** Normalized names shared by more than one option, used to add descriptors. */
export function duplicateMaterialNames(
  materials: readonly MaterialOptionLabelInput[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const material of materials) {
    const key = normalizedName(material.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
}

export function materialOptionLabel(
  material: MaterialOptionLabelInput,
  duplicateNames: ReadonlySet<string> = new Set(),
): string {
  const name = material.name.trim() || "未命名物料";
  const lowerName = normalizedName(name);
  const descriptors = classificationParts(material)
    .filter((part) => !lowerName.includes(normalizedName(part)));

  if (duplicateNames.has(lowerName)) {
    const kind = KIND_LABEL[material.kind] ?? material.kind;
    if (!lowerName.includes(normalizedName(kind)) && !descriptors.includes(kind)) {
      descriptors.push(kind);
    }
    const unit = material.baseUnit.trim();
    if (unit && !lowerName.includes(normalizedName(unit)) && !descriptors.includes(unit)) {
      descriptors.push(unit);
    }
  }

  const stock = material.availableQty > 0
    ? `可用 ${material.availableQty}${material.baseUnit}`
    : "无现货";
  const cost = material.standardUnitCost === null
    ? "未设成本"
    : `¥${material.standardUnitCost.toFixed(2)}/${material.baseUnit}`;
  const inactive = material.active ? "" : "（停用）";
  const descriptorText = descriptors.length > 0 ? ` · ${descriptors.join(" / ")}` : "";
  return `${name}${inactive}${descriptorText}（${stock}，${cost}）`;
}
