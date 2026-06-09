import { Prisma } from "@/generated/prisma/client";
import { LossMode } from "@/generated/prisma/enums";
import { decimal, money, unitCost, type DecimalInput } from "@/services/purchase-pure";

export const MIN_USABLE_RATE = 0.1;
export const DEFAULT_STANDARD_USABLE_RATE = 0.85;
export const DEFAULT_OPTIMISTIC_USABLE_RATE = 0.92;
export const DEFAULT_CONSERVATIVE_USABLE_RATE = 0.75;

export type NormalizeUsableRateResult = {
  usableRate: Prisma.Decimal;
  warnings: string[];
};

export type LossProfile = {
  optimisticUsableRate: number;
  standardUsableRate: number;
  conservativeUsableRate: number;
  defaultUsableRate: number;
  lossMode: LossMode;
};

export type FlowerWikiLossSource = {
  optimisticUsableRate?: DecimalInput;
  standardUsableRate?: DecimalInput;
  conservativeUsableRate?: DecimalInput;
  defaultUsableRate?: DecimalInput;
  lossMode?: LossMode | null;
};

export type LossAdjustedLineInput = {
  actualTotalCost: DecimalInput;
  actualUnitCost: DecimalInput;
  totalStems: DecimalInput;
  usableRate?: DecimalInput;
};

export type LossAdjustedLineResult = {
  usableRate: Prisma.Decimal;
  lossRate: Prisma.Decimal;
  lossAdjustedTotalCost: Prisma.Decimal;
  lossAdjustedUnitCost: Prisma.Decimal;
  lossModelExtraCost: Prisma.Decimal;
  warnings: string[];
};

function isEmptyRateInput(
  input: DecimalInput | string | null | undefined
): boolean {
  if (input === null || input === undefined) return true;
  if (typeof input === "string" && input.trim() === "") return true;
  return false;
}

function parseNumericRate(value: DecimalInput | string): number | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.endsWith("%")) {
      const percent = Number(trimmed.slice(0, -1).trim());
      return Number.isFinite(percent) ? percent : null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = decimal(value).toNumber();
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildDefaultLossProfile(): LossProfile {
  return {
    optimisticUsableRate: DEFAULT_OPTIMISTIC_USABLE_RATE,
    standardUsableRate: DEFAULT_STANDARD_USABLE_RATE,
    conservativeUsableRate: DEFAULT_CONSERVATIVE_USABLE_RATE,
    defaultUsableRate: DEFAULT_STANDARD_USABLE_RATE,
    lossMode: LossMode.STANDARD,
  };
}

export function normalizeUsableRate(
  input: DecimalInput | string | null | undefined,
  options?: { defaultRate?: number }
): NormalizeUsableRateResult {
  const warnings: string[] = [];
  const fallback = options?.defaultRate ?? 1;

  if (isEmptyRateInput(input)) {
    return { usableRate: decimal(fallback), warnings };
  }

  const raw = parseNumericRate(input as DecimalInput | string);
  if (raw === null) {
    warnings.push("可用率格式无效，已使用默认值");
    return { usableRate: decimal(fallback), warnings };
  }

  let rate: number;
  if (raw > 1 && raw <= 100) {
    rate = raw / 100;
  } else if (raw > 0 && raw <= 1) {
    rate = raw;
  } else {
    warnings.push("可用率须在 0–100% 之间，已使用默认值");
    return { usableRate: decimal(fallback), warnings };
  }

  if (rate < MIN_USABLE_RATE) {
    warnings.push(
      `可用率不能低于 ${(MIN_USABLE_RATE * 100).toFixed(0)}%，已调整为最低值`
    );
    rate = MIN_USABLE_RATE;
  }

  return { usableRate: decimal(rate), warnings };
}

export function getLossRateFromUsableRate(
  usableRate: DecimalInput
): Prisma.Decimal {
  const normalized = normalizeUsableRate(usableRate, {
    defaultRate: DEFAULT_STANDARD_USABLE_RATE,
  });
  return decimal(1).minus(normalized.usableRate);
}

export function calculateLossAdjustedUnitCost(
  actualUnitCost: DecimalInput,
  usableRate: DecimalInput
): { lossAdjustedUnitCost: Prisma.Decimal; warnings: string[] } {
  const warnings: string[] = [];
  const cost = unitCost(actualUnitCost ?? 0);
  const normalized = normalizeUsableRate(usableRate, {
    defaultRate: DEFAULT_STANDARD_USABLE_RATE,
  });
  warnings.push(...normalized.warnings);

  if (normalized.usableRate.lte(0)) {
    warnings.push("可用率无效，损耗后单支成本按实际单支成本计算");
    return { lossAdjustedUnitCost: cost, warnings };
  }

  return {
    lossAdjustedUnitCost: unitCost(cost.div(normalized.usableRate)),
    warnings,
  };
}

export function calculateLossAdjustedLineCost(
  line: LossAdjustedLineInput
): LossAdjustedLineResult {
  const warnings: string[] = [];
  const actualTotalCost = money(line.actualTotalCost ?? 0);
  const actualUnitCost = unitCost(line.actualUnitCost ?? 0);
  const totalStems = decimal(line.totalStems ?? 0);
  const normalized = normalizeUsableRate(line.usableRate, {
    defaultRate: DEFAULT_STANDARD_USABLE_RATE,
  });
  warnings.push(...normalized.warnings);

  const usableRate = normalized.usableRate;
  const lossRate = getLossRateFromUsableRate(usableRate);
  const { lossAdjustedUnitCost, warnings: unitWarnings } =
    calculateLossAdjustedUnitCost(actualUnitCost, usableRate);
  warnings.push(...unitWarnings);

  const lossAdjustedTotalCost = money(lossAdjustedUnitCost.times(totalStems));
  const lossModelExtraCost = money(
    lossAdjustedTotalCost.minus(actualTotalCost)
  );

  return {
    usableRate,
    lossRate,
    lossAdjustedTotalCost,
    lossAdjustedUnitCost,
    lossModelExtraCost,
    warnings,
  };
}

export function getUsableRateByMode(
  flowerWiki: FlowerWikiLossSource | null | undefined,
  mode: LossMode
): Prisma.Decimal {
  const defaults = buildDefaultLossProfile();
  const pick = (value?: DecimalInput, fallback?: number) => {
    if (!isEmptyRateInput(value)) {
      return normalizeUsableRate(value, { defaultRate: fallback ?? 1 })
        .usableRate;
    }
    return null;
  };

  if (mode === LossMode.OPTIMISTIC) {
    return (
      pick(flowerWiki?.optimisticUsableRate) ??
      pick(flowerWiki?.standardUsableRate) ??
      pick(flowerWiki?.defaultUsableRate) ??
      decimal(defaults.optimisticUsableRate)
    );
  }

  if (mode === LossMode.CONSERVATIVE) {
    return (
      pick(flowerWiki?.conservativeUsableRate) ??
      decimal(defaults.conservativeUsableRate)
    );
  }

  return (
    pick(flowerWiki?.standardUsableRate) ??
    pick(flowerWiki?.defaultUsableRate) ??
    decimal(defaults.standardUsableRate)
  );
}

export function resolveWikiDefaultUsableRate(
  flowerWiki: FlowerWikiLossSource | null | undefined
): Prisma.Decimal | null {
  const standard = flowerWiki?.standardUsableRate;
  if (!isEmptyRateInput(standard)) {
    return normalizeUsableRate(standard, {
      defaultRate: DEFAULT_STANDARD_USABLE_RATE,
    }).usableRate;
  }
  const fallback = flowerWiki?.defaultUsableRate;
  if (!isEmptyRateInput(fallback)) {
    return normalizeUsableRate(fallback, {
      defaultRate: DEFAULT_STANDARD_USABLE_RATE,
    }).usableRate;
  }
  return null;
}

export function formatUsableRatePercent(value: DecimalInput): string {
  const normalized = normalizeUsableRate(value, {
    defaultRate: DEFAULT_STANDARD_USABLE_RATE,
  });
  return `${normalized.usableRate.times(100).toFixed(1)}%`;
}
