import { Prisma } from "@/generated/prisma/client";
import {
  decimalToString,
  money,
  ratio,
  type DecimalInput,
} from "./order-cost-pure";

export type MarginLevel =
  | "低毛利"
  | "偏低"
  | "健康"
  | "优秀"
  | "高毛利，需检查定价或成本是否漏填";

export type ProductMarginMaterialInput = {
  flowerWikiId: string;
  flowerName: string;
  quantityNeeded: number;
  standardUnitCost: DecimalInput;
};

export type ProductMarginMaterialLine = {
  flowerWikiId: string;
  flowerName: string;
  quantityNeeded: number;
  standardUnitCost: string | null;
  lineCost: string;
  warning?: string;
};

export type SuggestedPrice = {
  targetMargin: string;
  price: string;
};

export const DEFAULT_TARGET_MARGINS = [0.45, 0.55, 0.6, 0.65] as const;

export function roundFlowerPrice(raw: DecimalInput): Prisma.Decimal {
  const price = Number(raw ?? 0);
  if (!Number.isFinite(price) || price <= 0) return money(0);

  if (price < 100) {
    const lower = Math.floor(price / 10) * 10 + 9;
    const upper = Math.ceil(price / 10) * 10;
    const rounded = Math.abs(price - lower) <= Math.abs(price - upper)
      ? lower
      : upper;
    return money(Math.max(0, rounded));
  }

  if (price <= 300) {
    return nearestCharmPrice(price, [8, 9], 10);
  }

  if (price <= 600) {
    return nearestCharmPrice(price, [8, 9, 0], 10);
  }

  const nearest10 = Math.round(price / 10) * 10;
  const nearest50 = Math.round(price / 50) * 50;
  return money(
    Math.abs(price - nearest10) <= Math.abs(price - nearest50)
      ? nearest10
      : nearest50
  );
}

function nearestCharmPrice(
  price: number,
  endings: number[],
  step: number
): Prisma.Decimal {
  const base = Math.floor(price / step) * step;
  const candidates: number[] = [];
  for (let offset = -2; offset <= 3; offset++) {
    const bucket = base + offset * step;
    if (bucket <= 0) continue;
    for (const ending of endings) {
      const candidate = Math.floor(bucket / 10) * 10 + ending;
      if (candidate > 0) candidates.push(candidate);
    }
  }
  const best = candidates.reduce((selected, candidate) =>
    Math.abs(candidate - price) < Math.abs(selected - price)
      ? candidate
      : selected
  );
  return money(best);
}

export function suggestPriceByTargetMargin(
  totalCost: DecimalInput,
  targetMargin: number | readonly number[] = DEFAULT_TARGET_MARGINS
): SuggestedPrice[] {
  const cost = money(totalCost);
  const targets = Array.isArray(targetMargin) ? targetMargin : [targetMargin];

  return targets
    .filter((target) => Number.isFinite(target) && target > 0 && target < 1)
    .map((target) => {
      const rawPrice = cost.greaterThan(0)
        ? cost.div(new Prisma.Decimal(1).minus(target))
        : money(0);
      return {
        targetMargin: ratio(target).toFixed(4),
        price: decimalToString(roundFlowerPrice(rawPrice)),
      };
    });
}

export function getMarginLevel(grossMargin: DecimalInput): MarginLevel {
  const value = Number(grossMargin ?? 0);
  if (value < 0.35) return "低毛利";
  if (value < 0.45) return "偏低";
  if (value <= 0.6) return "健康";
  if (value <= 0.7) return "优秀";
  return "高毛利，需检查定价或成本是否漏填";
}

export function calculateStandardMaterialLines(
  inputs: ProductMarginMaterialInput[]
): {
  materialCost: Prisma.Decimal;
  lines: ProductMarginMaterialLine[];
  warnings: string[];
} {
  let materialCost = money(0);
  const warnings: string[] = [];

  const lines = inputs.map((input) => {
    const quantityNeeded = Number.isFinite(input.quantityNeeded)
      ? Math.max(0, Math.round(input.quantityNeeded))
      : 0;
    const missingCost =
      input.standardUnitCost === null || input.standardUnitCost === undefined;
    const invalidQuantity = !Number.isFinite(input.quantityNeeded) ||
      input.quantityNeeded <= 0;

    const warningParts: string[] = [];
    if (missingCost) {
      warningParts.push("未设置标准单支成本，已按 0 计算");
      warnings.push(`花材「${input.flowerName}」未设置标准单支成本，已按 0 计算`);
    }
    if (invalidQuantity) {
      warningParts.push("配方用量异常，已按 0 计算");
      warnings.push(`花材「${input.flowerName}」配方用量异常，已按 0 计算`);
    }

    const unitCost = missingCost ? money(0) : money(input.standardUnitCost);
    const lineCost = invalidQuantity ? money(0) : money(unitCost.times(quantityNeeded));
    materialCost = money(materialCost.plus(lineCost));

    return {
      flowerWikiId: input.flowerWikiId,
      flowerName: input.flowerName,
      quantityNeeded: invalidQuantity ? 0 : quantityNeeded,
      standardUnitCost: missingCost ? null : decimalToString(unitCost, 4),
      lineCost: decimalToString(lineCost),
      warning: warningParts.length ? warningParts.join("；") : undefined,
    };
  });

  return { materialCost, lines, warnings };
}

export function calculateMarginFromPrice(input: {
  price: DecimalInput;
  materialCost: DecimalInput;
  packagingCost: DecimalInput;
}): {
  totalCost: Prisma.Decimal;
  estimatedGrossProfit: Prisma.Decimal;
  estimatedGrossMargin: Prisma.Decimal;
  warnings: string[];
} {
  const price = money(input.price);
  const totalCost = money(money(input.materialCost).plus(money(input.packagingCost)));
  const estimatedGrossProfit = money(price.minus(totalCost));
  const estimatedGrossMargin = price.greaterThan(0)
    ? ratio(estimatedGrossProfit.div(price))
    : ratio(0);
  const warnings = price.greaterThan(0) ? [] : ["SKU 售价为 0，毛利率按 0 计算"];

  return { totalCost, estimatedGrossProfit, estimatedGrossMargin, warnings };
}
