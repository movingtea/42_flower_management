/**
 * Pure sample-plan calculation.
 *
 * The plan is a forecast only. It reads a stock/cost snapshot, simulates the
 * configured production sequence and may recover a share of the material after
 * an intermediate sample is disassembled. It never reserves or moves stock;
 * approval and execution are transactional service actions.
 *
 * Accounting rules used here:
 * - stock and purchased material are incremental plan cost;
 * - material reused from an earlier disassembly carries no incremental cost;
 * - the last sample is retained, so it does not produce a reusable pool;
 * - an intermediate sample is disassembled after it is made, so its non-reusable
 *   share is an expected loss and its usable share feeds later steps.
 */

export const SAMPLE_PLAN_ALGORITHM_VERSION = "sample-plan-v1";
export const SAMPLE_PLAN_DEFAULT_MAX_STEPS = 12;
export const SAMPLE_PLAN_DEFAULT_MAX_SUGGESTIONS = 2;

const EPSILON = 1e-9;

export type SamplePlanningMaterial = {
  materialId: string;
  name: string;
  grade: string | null;
  baseUnit: string;
  quantityScale: number;
  /** Quantity required for one finished sample. */
  quantity: number;
  unitCost: number;
  availableQty: number;
  /** Expected share of the input recoverable after disassembly, 0..1. */
  reusableRate: number;
};

export type SamplePlanningSample = {
  sampleId: string;
  code: string;
  name: string;
  priority: number;
  materials: SamplePlanningMaterial[];
};

export type SamplePlanSelection = {
  sampleId: string;
  quantity: number;
  mandatory: boolean;
  sequenceNo?: number | null;
};

export type SamplePlanMaterialFlow = {
  materialId: string;
  materialNameSnapshot: string;
  gradeSnapshot: string | null;
  baseUnit: string;
  quantityScale: number;
  requiredQty: number;
  stockQty: number;
  reusedQty: number;
  purchaseQty: number;
  reusableAfterDisassemblyQty: number;
  lossQty: number;
  poolRemainingQty: number;
  incrementalCost: number;
  unitCost: number;
  availableQty: number;
  reusableRate: number;
};

export type SamplePlanStepResult = {
  sequenceNo: number;
  sampleId: string;
  sampleCode: string;
  sampleNameSnapshot: string;
  plannedQuantity: number;
  incrementalCost: number;
  materials: SamplePlanMaterialFlow[];
};

export type SamplePlanInventorySnapshot = {
  materialId: string;
  availableQty: number;
  unitCost: number;
  unitSnapshot: string;
};

export type SamplePlanRunResult = {
  rank: number;
  algorithmVersion: string;
  requestedSampleCount: number;
  steps: SamplePlanStepResult[];
  inventory: SamplePlanInventorySnapshot[];
  independentCost: number;
  totalCost: number;
  estimatedSaving: number;
  reuseRate: number;
  candidateSnapshot: {
    samples: {
      sampleId: string;
      code: string;
      name: string;
      quantity: number;
      mandatory: boolean;
      sequenceNo: number;
    }[];
    suggestedSampleIds: string[];
  };
  lossPolicySnapshot: {
    defaultReusableRate: number;
    byMaterialId: Record<string, number>;
  };
};

export type SamplePlanCalculationInput = {
  samples: readonly SamplePlanningSample[];
  selections: readonly SamplePlanSelection[];
  maxSuggestions?: number;
  maxSteps?: number;
  defaultReusableRate?: number;
};

export type SamplePlanCalculationResult = {
  runs: SamplePlanRunResult[];
  warnings: string[];
};

function finiteNonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}必须为非负有限数`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label}必须为正整数`);
  return value;
}

function clampRate(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function roundQty(value: number, scale: number): number {
  if (!Number.isInteger(scale) || scale < 0 || scale > 3) {
    throw new Error("物料计量精度无效");
  }
  const factor = 10 ** scale;
  return Math.round((value + EPSILON) * factor) / factor;
}

function roundMoney(value: number): number {
  return Math.round((value + EPSILON) * 100) / 100;
}

function roundRate(value: number): number {
  return Math.round((value + EPSILON) * 10_000) / 10_000;
}

type NormalizedSelection = {
  sample: SamplePlanningSample;
  quantity: number;
  mandatory: boolean;
  sequenceNo: number;
};

function sortBySequence(selections: readonly NormalizedSelection[]): NormalizedSelection[] {
  return [...selections].sort((left, right) => {
    const leftSequence = left.sequenceNo ?? Number.MAX_SAFE_INTEGER;
    const rightSequence = right.sequenceNo ?? Number.MAX_SAFE_INTEGER;
    if (leftSequence !== rightSequence) return leftSequence - rightSequence;
    if (left.sample.priority !== right.sample.priority) {
      return right.sample.priority - left.sample.priority;
    }
    return left.sample.code.localeCompare(right.sample.code);
  });
}

function suggestionScore(
  candidate: SamplePlanningSample,
  mandatory: readonly NormalizedSelection[],
): { overlap: number; inStock: number } {
  const requiredIds = new Set(
    mandatory.flatMap((selection) => selection.sample.materials.map((material) => material.materialId)),
  );
  let overlap = 0;
  let inStock = 0;
  for (const material of candidate.materials) {
    if (requiredIds.has(material.materialId)) overlap += 1;
    if (material.availableQty > 0) inStock += 1;
  }
  return { overlap, inStock };
}

/**
 * Candidate sequences:
 * - the mandatory samples only;
 * - mandatory plus the best matching optional sample;
 * - mandatory plus the best two optional samples.
 *
 * Optional suggestions are only added when exactly one mandatory sample was
 * selected, matching the confirmed rule that the algorithm may recommend a
 * pairing only for a single required sample.
 */
function buildCandidateSequences(
  base: readonly NormalizedSelection[],
  mandatory: readonly NormalizedSelection[],
  optional: readonly NormalizedSelection[],
  maxSuggestions: number,
  maxSteps: number,
): NormalizedSelection[][] {
  const sequences: NormalizedSelection[][] = [sortBySequence(base)];
  if (mandatory.length !== 1 || optional.length === 0) return sequences;

  const ranked = [...optional].sort((left, right) => {
    const leftScore = suggestionScore(left.sample, mandatory);
    const rightScore = suggestionScore(right.sample, mandatory);
    if (leftScore.overlap !== rightScore.overlap) {
      return rightScore.overlap - leftScore.overlap;
    }
    if (leftScore.inStock !== rightScore.inStock) {
      return rightScore.inStock - leftScore.inStock;
    }
    if (left.sample.priority !== right.sample.priority) {
      return right.sample.priority - left.sample.priority;
    }
    return left.sample.code.localeCompare(right.sample.code);
  });

  const availableSlots = Math.max(0, maxSteps - base.length);
  const suggestionLimit = Math.min(
    availableSlots,
    Math.max(0, Math.max(1, maxSuggestions) - 1),
  );
  for (let count = 1; count <= suggestionLimit; count += 1) {
    const suggestions = ranked.slice(0, count);
    sequences.push([
      ...sortBySequence(base),
      ...suggestions.map((selection) => ({ ...selection, sequenceNo: 0 })),
    ]);
  }

  const seen = new Set<string>();
  return sequences.filter((sequence) => {
    const key = sequence.map((selection) => selection.sample.sampleId).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function calculateSamplePlan(
  input: SamplePlanCalculationInput,
): SamplePlanCalculationResult {
  const warnings: string[] = [];
  const maxSteps = input.maxSteps ?? SAMPLE_PLAN_DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) throw new Error("最大打样步骤数必须为正整数");
  const maxSuggestions = input.maxSuggestions ?? SAMPLE_PLAN_DEFAULT_MAX_SUGGESTIONS;
  if (!Number.isInteger(maxSuggestions) || maxSuggestions <= 0) {
    throw new Error("最大推荐方案数必须为正整数");
  }
  const defaultReusableRate = clampRate(input.defaultReusableRate, 0);

  if (!Array.isArray(input.samples) || input.samples.length === 0) {
    throw new Error("没有可用的样品");
  }
  if (!Array.isArray(input.selections) || input.selections.length === 0) {
    throw new Error("打样计划至少需要一个样品");
  }

  const sampleById = new Map<string, SamplePlanningSample>();
  for (const sample of input.samples) {
    if (!sample.sampleId) throw new Error("样品标识不能为空");
    if (sampleById.has(sample.sampleId)) throw new Error("样品不能重复");
    if (!Array.isArray(sample.materials)) throw new Error("样品物料清单无效");
    sampleById.set(sample.sampleId, sample);
  }

  const normalized: NormalizedSelection[] = input.selections.map((selection) => {
    const sample = sampleById.get(selection.sampleId);
    if (!sample) throw new Error("样品不存在或不属于当前租户");
    const quantity = positiveInteger(selection.quantity, "样品数量");
    if (sample.materials.length === 0) throw new Error(`${sample.name} 还没有花材搭配`);
    const seenMaterials = new Set<string>();
    for (const material of sample.materials) {
      if (seenMaterials.has(material.materialId)) {
        throw new Error(`${sample.name} 的物料不能重复`);
      }
      seenMaterials.add(material.materialId);
      finiteNonnegative(material.quantity, `${sample.name} 的用量`);
      finiteNonnegative(material.unitCost, `${sample.name} 的物料成本`);
      finiteNonnegative(material.availableQty, `${sample.name} 的可用库存`);
      if (material.quantity <= 0) throw new Error(`${sample.name} 的用量必须大于零`);
    }
    return {
      sample,
      quantity,
      mandatory: Boolean(selection.mandatory),
      sequenceNo: Number.isInteger(selection.sequenceNo)
        ? Number(selection.sequenceNo)
        : Number.MAX_SAFE_INTEGER,
    };
  });

  const mandatory = normalized.filter((selection) => selection.mandatory);
  if (mandatory.length === 0) throw new Error("打样计划至少需要一个必选样品");
  if (normalized.length > maxSteps) {
    throw new Error(`打样步骤不能超过 ${maxSteps} 步`);
  }

  const selectedIds = new Set(normalized.map((selection) => selection.sample.sampleId));
  const optional: NormalizedSelection[] = input.samples
    .filter((sample) => !selectedIds.has(sample.sampleId) && sample.materials.length > 0)
    .map((sample) => ({
      sample,
      quantity: 1,
      mandatory: false,
      sequenceNo: Number.MAX_SAFE_INTEGER,
    }));
  if (mandatory.length > 1 && optional.length > 0) {
    warnings.push("已选择多个必选样品，本次不再自动追加建议样品。");
  }

  const sequences = buildCandidateSequences(
    normalized,
    mandatory,
    optional,
    maxSuggestions,
    maxSteps,
  );
  const runs: SamplePlanRunResult[] = [];

  for (const sequence of sequences) {
    const stockRemaining = new Map<string, number>();
    const pool = new Map<string, number>();
    const materialInfo = new Map<string, SamplePlanningMaterial>();
    const ratesByMaterial = new Map<string, number>();
    let independentCost = 0;
    let totalCost = 0;
    let reusedCost = 0;
    let inputCost = 0;
    let totalRequired = 0;

    const steps: SamplePlanStepResult[] = sequence.map((selection, index) => {
      const isLast = index === sequence.length - 1;
      const stepMaterials: SamplePlanMaterialFlow[] = [];
      let stepCost = 0;

      for (const material of selection.sample.materials) {
        const requiredQty = roundQty(
          material.quantity * selection.quantity,
          material.quantityScale,
        );
        if (requiredQty <= 0) continue;

        materialInfo.set(material.materialId, material);
        const rate = clampRate(
          material.reusableRate,
          defaultReusableRate,
        );
        ratesByMaterial.set(material.materialId, rate);

        const stockBefore = stockRemaining.get(material.materialId) ?? material.availableQty;
        const poolBefore = pool.get(material.materialId) ?? 0;
        const fromPool = roundQty(
          Math.min(poolBefore, requiredQty),
          material.quantityScale,
        );
        const afterPool = roundQty(requiredQty - fromPool, material.quantityScale);
        const fromStock = roundQty(
          Math.min(Math.max(0, stockBefore), afterPool),
          material.quantityScale,
        );
        const purchaseQty = roundQty(
          Math.max(0, afterPool - fromStock),
          material.quantityScale,
        );
        const stockAfter = roundQty(Math.max(0, stockBefore - fromStock), material.quantityScale);
        stockRemaining.set(material.materialId, stockAfter);
        pool.set(material.materialId, roundQty(Math.max(0, poolBefore - fromPool), material.quantityScale));

        const inputQty = roundQty(fromStock + fromPool + purchaseQty, material.quantityScale);
        const reusableQty = isLast
          ? 0
          : roundQty(inputQty * rate, material.quantityScale);
        const lossQty = isLast
          ? 0
          : roundQty(Math.max(0, inputQty - reusableQty), material.quantityScale);
        if (!isLast && reusableQty > 0) {
          const existing = pool.get(material.materialId) ?? 0;
          pool.set(material.materialId, roundQty(existing + reusableQty, material.quantityScale));
        }

        const incrementalCost = roundMoney((fromStock + purchaseQty) * material.unitCost);
        const requiredCost = roundMoney(requiredQty * material.unitCost);
        stepCost = roundMoney(stepCost + incrementalCost);
        independentCost = roundMoney(independentCost + requiredCost);
        totalCost = roundMoney(totalCost + incrementalCost);
        reusedCost = roundMoney(reusedCost + fromPool * material.unitCost);
        inputCost = roundMoney(inputCost + inputQty * material.unitCost);
        totalRequired = roundQty(totalRequired + requiredQty, 3);

        stepMaterials.push({
          materialId: material.materialId,
          materialNameSnapshot: material.name,
          gradeSnapshot: material.grade,
          baseUnit: material.baseUnit,
          quantityScale: material.quantityScale,
          requiredQty,
          stockQty: fromStock,
          reusedQty: fromPool,
          purchaseQty,
          reusableAfterDisassemblyQty: reusableQty,
          lossQty,
          poolRemainingQty: pool.get(material.materialId) ?? 0,
          incrementalCost,
          unitCost: material.unitCost,
          availableQty: material.availableQty,
          reusableRate: rate,
        });
      }

      return {
        sequenceNo: index + 1,
        sampleId: selection.sample.sampleId,
        sampleCode: selection.sample.code,
        sampleNameSnapshot: selection.sample.name,
        plannedQuantity: selection.quantity,
        incrementalCost: stepCost,
        materials: stepMaterials,
      };
    });

    const inventory = [...materialInfo.values()]
      .sort((left, right) => left.materialId.localeCompare(right.materialId))
      .map((material) => ({
        materialId: material.materialId,
        availableQty: material.availableQty,
        unitCost: material.unitCost,
        unitSnapshot: `${material.availableQty}${material.baseUnit} 可用 · ¥${material.unitCost.toFixed(4)}/${material.baseUnit} · 复用率 ${(clampRate(material.reusableRate, defaultReusableRate) * 100).toFixed(0)}%`,
      }));

    const reuseRate = inputCost > 0 ? clampRate(reusedCost / inputCost, 0) : 0;
    runs.push({
      rank: 0,
      algorithmVersion: SAMPLE_PLAN_ALGORITHM_VERSION,
      requestedSampleCount: sequence.reduce((sum, selection) => sum + selection.quantity, 0),
      steps,
      inventory,
      independentCost: roundMoney(independentCost),
      totalCost: roundMoney(totalCost),
      estimatedSaving: roundMoney(Math.max(0, independentCost - totalCost)),
      reuseRate: roundRate(reuseRate),
      candidateSnapshot: {
        samples: sequence.map((selection, index) => ({
          sampleId: selection.sample.sampleId,
          code: selection.sample.code,
          name: selection.sample.name,
          quantity: selection.quantity,
          mandatory: selection.mandatory,
          sequenceNo: index + 1,
        })),
        suggestedSampleIds: sequence
          .filter((selection) => !selection.mandatory)
          .map((selection) => selection.sample.sampleId),
      },
      lossPolicySnapshot: {
        defaultReusableRate,
        byMaterialId: Object.fromEntries(
          [...ratesByMaterial.entries()].sort(([left], [right]) => left.localeCompare(right)),
        ),
      },
    });

    if (totalRequired === 0) warnings.push("计划没有产生物料需求。");
  }

  runs.sort((left, right) => {
    if (left.estimatedSaving !== right.estimatedSaving) {
      return right.estimatedSaving - left.estimatedSaving;
    }
    if (left.reuseRate !== right.reuseRate) return right.reuseRate - left.reuseRate;
    if (left.totalCost !== right.totalCost) return left.totalCost - right.totalCost;
    return left.steps.length - right.steps.length;
  });
  runs.forEach((run, index) => {
    run.rank = index + 1;
  });

  return { runs, warnings };
}

/** Per-material requirement for one sample, used by the sample cost calculator. */
export function sampleMaterialCost(
  lines: readonly { quantity: number; unitCost: number }[],
): number {
  return roundMoney(lines.reduce((sum, line) => {
    finiteNonnegative(line.quantity, "物料用量");
    finiteNonnegative(line.unitCost, "物料成本");
    return sum + line.quantity * line.unitCost;
  }, 0));
}
