/**
 * Confirmed sample material substitution (batch 2).
 *
 * A shortage may be covered by a material that matches the original flower at
 * one of three classification levels:
 * - exact: 种类 + 颜色 + 商品名；
 * - varietyColor: 种类 + 颜色；
 * - variety: 只有种类相同。
 *
 * The proposal is advisory. Nothing is replaced until an employee explicitly
 * confirms it through `confirmSampleMaterialSubstitution`; the original demand
 * and history remain intact in that flow.
 */

export type SampleSubstitutionTier = "exact" | "varietyColor" | "variety";

export type SampleSubstitutionMaterial = {
  materialId: string;
  code: string;
  name: string;
  kind: string;
  baseUnit: string;
  flowerVariety: string | null;
  flowerProductName: string | null;
  color: string | null;
  availableQty: number;
  unitCost: number;
  active?: boolean;
};

export type SampleSubstitutionRequirement = {
  materialId: string;
  name: string;
  quantity: number;
  availableQty: number;
  kind: string;
  baseUnit: string;
  flowerVariety: string | null;
  flowerProductName: string | null;
  color: string | null;
};

export type SampleSubstitutionOption = SampleSubstitutionMaterial & {
  tier: SampleSubstitutionTier;
};

export type SampleSubstitutionProposal = {
  fromMaterialId: string;
  fromMaterialName: string;
  requiredQty: number;
  availableQty: number;
  baseUnit: string;
  options: SampleSubstitutionOption[];
};

const TIER_RANK: Record<SampleSubstitutionTier, number> = {
  exact: 3,
  varietyColor: 2,
  variety: 1,
};

export const SAMPLE_SUBSTITUTION_TIER_LABELS: Record<SampleSubstitutionTier, string> = {
  exact: "三级全同",
  varietyColor: "种类+颜色相同",
  variety: "种类相同",
};

function normalized(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function sampleSubstitutionTier(
  required: Pick<SampleSubstitutionRequirement, "flowerVariety" | "flowerProductName" | "color">,
  candidate: Pick<SampleSubstitutionMaterial, "flowerVariety" | "flowerProductName" | "color">,
): SampleSubstitutionTier | null {
  const requiredVariety = normalized(required.flowerVariety);
  const candidateVariety = normalized(candidate.flowerVariety);
  if (!requiredVariety || requiredVariety !== candidateVariety) return null;
  const requiredColor = normalized(required.color);
  const candidateColor = normalized(candidate.color);
  if (requiredColor && candidateColor && requiredColor === candidateColor) {
    const requiredProduct = normalized(required.flowerProductName);
    return requiredProduct && requiredProduct === normalized(candidate.flowerProductName)
      ? "exact"
      : "varietyColor";
  }
  return "variety";
}

/**
 * Produce substitution proposals for every material currently short in the
 * sample. A material with enough stock produces no proposal. Candidates must
 * be active, use the same kind and base unit, and not already be in the sample.
 */
export function proposeSampleSubstitutions(input: {
  requirements: readonly SampleSubstitutionRequirement[];
  candidates: readonly SampleSubstitutionMaterial[];
  maxOptions?: number;
}): SampleSubstitutionProposal[] {
  const maxOptions = input.maxOptions ?? 3;
  if (!Number.isInteger(maxOptions) || maxOptions <= 0) {
    throw new Error("换料候选数必须为正整数");
  }
  const requiredIds = new Set(input.requirements.map((requirement) => requirement.materialId));
  const proposals: SampleSubstitutionProposal[] = [];

  for (const requirement of input.requirements) {
    if (requirement.availableQty >= requirement.quantity) continue;
    const options: SampleSubstitutionOption[] = [];
    for (const candidate of input.candidates) {
      if (candidate.materialId === requirement.materialId) continue;
      if (requiredIds.has(candidate.materialId)) continue;
      if (candidate.active === false) continue;
      if (candidate.kind !== requirement.kind) continue;
      if (candidate.baseUnit !== requirement.baseUnit) continue;
      if (candidate.availableQty <= 0) continue;
      const tier = sampleSubstitutionTier(requirement, candidate);
      if (!tier) continue;
      options.push({ ...candidate, tier });
    }
    options.sort((left, right) => {
      if (left.tier !== right.tier) return TIER_RANK[right.tier] - TIER_RANK[left.tier];
      if (left.availableQty !== right.availableQty) return right.availableQty - left.availableQty;
      if (left.unitCost !== right.unitCost) return left.unitCost - right.unitCost;
      return left.code.localeCompare(right.code);
    });
    proposals.push({
      fromMaterialId: requirement.materialId,
      fromMaterialName: requirement.name,
      requiredQty: requirement.quantity,
      availableQty: requirement.availableQty,
      baseUnit: requirement.baseUnit,
      options: options.slice(0, maxOptions),
    });
  }
  return proposals;
}
