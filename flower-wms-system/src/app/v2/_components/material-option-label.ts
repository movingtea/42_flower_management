/**
 * Shared formatting for material pickers.
 *
 * The submitted value always stays the material id; these helpers only decide
 * what staff read in the closed select and its option list. `materialPickerLabel`
 * is the compact identity form used by business forms (name · unit). The
 * system-generated material code is intentionally not displayed here: staff
 * choose materials by name and unit, and the code stays visible in the material
 * master table and detail drawer where it is needed for auditing.
 *
 * `materialPickerDetailLabel` adds grade/colour/specification for replacement
 * pickers. `materialOptionLabel` below is the richer samples label that adds
 * stock and cost context and resolves duplicate names.
 *
 * `materialPickerClass` keeps the control wide enough for a realistic material
 * name on desktop and lets it shrink on narrow screens; the option text is never
 * truncated by a fixed width.
 */

export type MaterialPickerIdentity = {
  name: string;
  baseUnit: string;
  active?: boolean;
};

/** Field width for material pickers, shared by every business form. */
export const materialPickerClass = "min-w-0 w-full sm:min-w-[18rem]";

export function materialPickerLabel(material: MaterialPickerIdentity): string {
  const name = material.name.trim() || "未命名物料";
  const unit = material.baseUnit.trim();
  const inactive = material.active === false ? "（已停用）" : "";
  return `${name}${inactive}${unit ? `（${unit}）` : ""}`;
}

export type MaterialPickerDetail = MaterialPickerIdentity & {
  grade?: string | null;
  color?: string | null;
  specification?: string | null;
};

/**
 * Picker label for replacement/alternative materials. It keeps the grade,
 * colour and specification that distinguish similar materials, but still omits
 * the system-generated code. Details already present in the (auto-generated)
 * name are not repeated.
 */
export function materialPickerDetailLabel(material: MaterialPickerDetail): string {
  const identity = materialPickerLabel(material);
  const lowerName = (material.name.trim() || "未命名物料").toLocaleLowerCase("zh-CN");
  const details = [material.grade, material.color, material.specification]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0 && !lowerName.includes(part.toLocaleLowerCase("zh-CN")));
  return details.length > 0 ? `${identity} · ${details.join(" · ")}` : identity;
}

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
