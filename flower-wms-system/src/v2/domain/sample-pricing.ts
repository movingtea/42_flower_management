/** Sample cost, target price and reporting calculations shared by services and pages. */

const EPSILON = 1e-8;

function money(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}必须为非负有限数`);
  return Math.round((value + EPSILON) * 100) / 100;
}

function ratio(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(`${label}必须大于等于 0 且小于 1`);
  }
  return value;
}

export type SamplePricingInput = {
  materialCost: number;
  packagingCost?: number;
  laborCost?: number;
  targetMarginRate?: number | null;
  targetPrice?: number | null;
};

export type SamplePricingResult = {
  materialCost: number;
  packagingCost: number;
  laborCost: number;
  totalCost: number;
  targetMarginRate: number | null;
  suggestedPrice: number | null;
  targetPrice: number | null;
  marginAtTargetPrice: number | null;
};

/**
 * Target price is derived from a gross-margin target: price = cost / (1 - margin).
 * When an explicit target price is supplied, the realised margin is returned too.
 * A 100% margin is rejected because it has no finite price.
 */
export function calculateSamplePricing(input: SamplePricingInput): SamplePricingResult {
  const materialCost = money(input.materialCost, "材料成本");
  const packagingCost = money(input.packagingCost ?? 0, "包装成本");
  const laborCost = money(input.laborCost ?? 0, "人工成本");
  const totalCost = money(materialCost + packagingCost + laborCost, "样品总成本");
  const marginRate = input.targetMarginRate === null || input.targetMarginRate === undefined
    ? null
    : ratio(input.targetMarginRate, "目标毛利率");
  const suggestedPrice = marginRate === null
    ? null
    : money(totalCost / (1 - marginRate), "建议售价");
  const targetPrice = input.targetPrice === null || input.targetPrice === undefined
    ? null
    : money(input.targetPrice, "目标售价");
  const marginAtTargetPrice = targetPrice !== null && targetPrice > 0
    ? Math.round((((targetPrice - totalCost) / targetPrice) + EPSILON) * 10_000) / 10_000
    : null;
  return {
    materialCost,
    packagingCost,
    laborCost,
    totalCost,
    targetMarginRate: marginRate,
    suggestedPrice,
    targetPrice,
    marginAtTargetPrice,
  };
}

export type CostVarianceResult = {
  plannedCost: number;
  actualCost: number;
  variance: number;
  varianceRate: number | null;
  overBudget: boolean;
};

export function costVariance(plannedCost: number, actualCost: number): CostVarianceResult {
  const planned = money(plannedCost, "计划成本");
  const actual = money(actualCost, "实际成本");
  const variance = Math.round((actual - planned + EPSILON) * 100) / 100;
  return {
    plannedCost: planned,
    actualCost: actual,
    variance,
    varianceRate: planned > 0 ? Math.round((variance / planned + EPSILON) * 10_000) / 10_000 : null,
    overBudget: variance > 0,
  };
}

export function conversionRate(convertedCount: number, eligibleCount: number): number {
  if (!Number.isInteger(convertedCount) || convertedCount < 0) {
    throw new Error("已转化样品数必须为非负整数");
  }
  if (!Number.isInteger(eligibleCount) || eligibleCount < 0) {
    throw new Error("可转化样品数必须为非负整数");
  }
  if (eligibleCount === 0) return 0;
  return Math.round((convertedCount / eligibleCount + EPSILON) * 10_000) / 10_000;
}

export function reuseRate(reusedCost: number, inputCost: number): number {
  const reused = money(reusedCost, "复用成本");
  const input = money(inputCost, "投入成本");
  if (input === 0) return 0;
  return Math.round((reused / input + EPSILON) * 10_000) / 10_000;
}
