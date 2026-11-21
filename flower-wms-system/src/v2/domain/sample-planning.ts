/**
 * Pure sample-plan calculation.
 *
 * The plan is an ideal-reuse forecast only. It reads a stock/cost snapshot,
 * simulates the configured production sequence and assumes that material is
 * fully recoverable after an intermediate sample is disassembled. It never
 * reserves or moves stock; approval and execution are transactional service
 * actions.
 *
 * Accounting rules used here:
 * - stock and purchased material are incremental plan cost;
 * - material reused from an earlier disassembly carries no incremental cost;
 * - the last sample is retained, so it does not produce a reusable pool;
 * - production and disassembly expected loss is zero, including the last step;
 * - an intermediate sample releases 100% of its input into the later-step pool;
 * - material usable-rate fields are deliberately ignored by this forecast.
 */

export const SAMPLE_PLAN_ALGORITHM_VERSION = "sample-plan-v4-batch2";
export const SAMPLE_PLAN_IDEAL_REUSE_RATE = 1;

/** Persisted versions that use the ideal-reuse (100%) accounting assumption. */
const IDEAL_REUSE_ALGORITHM_VERSIONS = new Set([
  "sample-plan-v3-ideal-reuse",
  SAMPLE_PLAN_ALGORITHM_VERSION,
]);

/**
 * Whether a persisted run was calculated with the ideal-reuse assumptions.
 * Old runs keep their original algorithm version and snapshot; the page must
 * not label pre-ideal runs as ideal.
 */
export function isIdealReuseAlgorithmVersion(version: string | null | undefined): boolean {
  return typeof version === "string" && IDEAL_REUSE_ALGORITHM_VERSIONS.has(version);
}

/** Whether a persisted run includes the batch-2 schedule snapshot. */
export function isBatch2AlgorithmVersion(version: string | null | undefined): boolean {
  return version === SAMPLE_PLAN_ALGORITHM_VERSION;
}

export const SAMPLE_PLAN_DEFAULT_MAX_STEPS = 12;
export const SAMPLE_PLAN_DEFAULT_MAX_SUGGESTIONS = 2;

const EPSILON = 1e-9;

/**
 * Flower material three-level classification (种类 / 颜色 / 商品名).
 * `color` reuses Material.color; the optional service fields are mapped from
 * Material.flowerVariety / Material.color / Material.flowerProductName.
 */
export type SamplePlanClassification = {
  flowerVariety: string | null;
  flowerProductName: string | null;
  color: string | null;
};

/**
 * Tier of a classification overlap used for ranking only:
 * - exact: 种类 + 颜色 + 商品名 全部相同；
 * - varietyColor: 种类 + 颜色相同，商品名不同或缺失；
 * - variety: 只有种类相同（颜色或商品名不同/缺失）。
 */
export type SamplePlanClassificationTier = "exact" | "varietyColor" | "variety";

export type SamplePlanClassificationMatch = {
  flowerVariety: string;
  flowerProductName: string | null;
  color: string | null;
  tier: SamplePlanClassificationTier;
};

/** Why an optional sample was appended as a suggestion. Advisory only. */
export type SamplePlanSuggestionReason = {
  sampleId: string;
  /** Master sample this optional sample was matched against. */
  masterSampleId: string;
  /** Count of candidate materials whose materialId is already required. */
  overlap: number;
  /** Count of candidate materials matching a required material at the exact tier. */
  exactClass: number;
  /** Count of candidate materials matching a required material at the varietyColor tier. */
  varietyColor: number;
  /** Count of candidate materials matching only the variety tier (batch 2). */
  varietyClass?: number;
  /** Count of candidate materials that currently have stock. */
  inStock: number;
  /** Shared classifications of the required materials that triggered the signal. */
  matchedClassifications: SamplePlanClassificationMatch[];
};

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
  /**
   * Legacy input. Kept optional for direct-call compatibility, but the ideal
   * forecast ignores it: a disassembled step always releases 100% of its input.
   * @deprecated The ideal-reuse simulation does not read material usable rates.
   */
  reusableRate?: number;
  /** Flower variety (种类). Optional so older callers keep working; null/empty means unknown. */
  flowerVariety?: string | null;
  /** Flower product name (商品名, 三级分类第三级). Only meaningful together with flowerVariety. */
  flowerProductName?: string | null;
  /** Flower color (颜色), reusing Material.color. */
  color?: string | null;
  /** Photography deadline for this sample. */
  photoDueAt?: Date | string | null;
  /** How long the finished sample must be retained (留样). */
  retentionUntil?: Date | string | null;
};

export type SamplePlanningSample = {
  sampleId: string;
  code: string;
  name: string;
  priority: number;
  materials: SamplePlanningMaterial[];
  /** Default photography deadline; a plan item may override it. */
  photoDueAt?: Date | string | null;
  /** Default retention deadline; a plan item may override it. */
  retentionUntil?: Date | string | null;
};

export type SamplePlanSelection = {
  sampleId: string;
  quantity: number;
  mandatory: boolean;
  sequenceNo?: number | null;
  /** Per-plan photography deadline override. */
  photoDueAt?: Date | string | null;
  /** Per-plan retention deadline override. */
  retentionUntil?: Date | string | null;
};

export type SamplePlanScheduleStep = {
  sequenceNo: number;
  sampleId: string;
  sampleName: string;
  plannedStartAt: string;
  plannedEndAt: string;
  photoDueAt: string | null;
  retentionUntil: string | null;
  retained: boolean;
  warnings: string[];
};

export type SamplePlanSchedule = {
  autoScheduled: boolean;
  warnings: string[];
  steps: SamplePlanScheduleStep[];
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
  /** Qualified flower material still needed after the pool and stock. */
  purchaseQty: number;
  reusableAfterDisassemblyQty: number;
  lossQty: number;
  poolRemainingQty: number;
  incrementalCost: number;
  unitCost: number;
  availableQty: number;
  /** Ideal share released after disassembly; zero for the retained last step. */
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
  plannedStartAt: string;
  plannedEndAt: string;
  photoDueAt: string | null;
  retentionUntil: string | null;
  retained: boolean;
  scheduleWarnings: string[];
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
  /** Batch-2 auto schedule constrained by photography and retention dates. */
  schedule: SamplePlanSchedule;
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
    /**
     * Reason for each non-mandatory sample in the sequence. Classification
     * signals rank recommendations only; they never change reuse quantities,
     * cost or reservations (WMS-BR-SMP-001/002/003).
     */
    suggestedSampleReasons: SamplePlanSuggestionReason[];
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
  /**
   * When true (default), a sequence with photography or retention constraints
   * is reordered so earlier photo deadlines come first and retained samples are
   * kept last. A sequence without constraints keeps the manual order.
   */
  autoSchedule?: boolean;
  /** Clock used for the planned schedule; defaults to `new Date()`. */
  now?: Date;
  /** Minutes allocated to one production step in the forecast. */
  stepDurationMinutes?: number;
  /**
   * Legacy input. Kept optional for direct-call compatibility, but ignored:
   * this version always uses the ideal 100% reuse assumption.
   * @deprecated The ideal-reuse simulation does not read a configured rate.
   */
  defaultReusableRate?: number;
};

export type SamplePlanCalculationResult = {
  runs: SamplePlanRunResult[];
  warnings: string[];
};

/**
 * One material of a companion recommendation, used by the drawer's expandable
 * per-item reuse breakdown. `remainingQty` is what the trial still needs after
 * the main sample's disassembly, before any stock or purchase is considered.
 */
export type SamplePlanCompanionMaterial = {
  materialId: string;
  name: string;
  baseUnit: string;
  /** Candidate's requirement for this material in one sample. */
  requiredQty: number;
  /** Quantity covered by the disassembled main sample. */
  reusedQty: number;
  /** `requiredQty - reusedQty`, never negative. */
  remainingQty: number;
};

/**
 * One optional sample compared with the single main sample. The values are a
 * two-step trial (main sample first, this candidate second) and are advisory:
 * they do not reserve stock and do not change the actual reuse/cost rules.
 */
export type SamplePlanCompanionRecommendation = {
  sampleId: string;
  code: string;
  name: string;
  /** Candidate's total requirement for one sample, summed across its materials. */
  requiredQty: number;
  /** Quantity that the disassembled main sample can cover for this candidate. */
  reusedQty: number;
  /** `reusedQty / requiredQty`, rounded to four decimals. */
  reuseRate: number;
  /**
   * Per-material reuse breakdown, ordered by reused quantity. The drawer shows
   * it only when the row is expanded; it never changes the recommendation
   * ordering or the actual plan calculation.
   */
  materials: SamplePlanCompanionMaterial[];
  /**
   * True when the candidate recipe contains a material that is not in the main
   * recipe. Such a swap must be confirmed by an employee before production;
   * classification matching alone never creates real reuse.
   */
  requiresSubstitution: boolean;
  /** Strongest flower classification overlap with the main sample, if any. */
  classificationTier: SamplePlanClassificationTier | null;
  /** Shared base unit across the candidate's materials, or null when mixed. */
  baseUnit: string | null;
};

export type SamplePlanCompanionRecommendationResult = {
  candidates: SamplePlanCompanionRecommendation[];
  /** Eligible candidates before the requested companion limit is applied. */
  eligibleCount: number;
  /** Companion slots requested by the user (`plannedCount - 1`). */
  requestedCount: number;
};

function bestClassificationTier(
  main: SamplePlanningSample,
  candidate: SamplePlanningSample,
): SamplePlanClassificationTier | null {
  let best: SamplePlanClassificationTier | null = null;
  for (const candidateMaterial of candidate.materials) {
    for (const mainMaterial of main.materials) {
      const tier = classificationTier(mainMaterial, candidateMaterial);
      if (!tier) continue;
      if (best === null || CLASSIFICATION_RANK[tier] > CLASSIFICATION_RANK[best]) {
        best = tier;
      }
    }
  }
  return best;
}

function sharedBaseUnit(materials: readonly SamplePlanningMaterial[]): string | null {
  if (materials.length === 0) return null;
  const unit = materials[0]!.baseUnit;
  return materials.every((material) => material.baseUnit === unit) ? unit : null;
}

/**
 * Single-main recommendation logic for the creation drawer.
 *
 * Each candidate is simulated independently as `main -> candidate` using the
 * same ideal-reuse accounting as the real plan: the main sample is disassembled
 * and only identical material identities can be reused. The candidate's
 * expected reuse rate is the reused share of its own requirement. Candidates
 * are ranked by that rate, then reused quantity, classification tier, priority
 * and code. Classification differences only produce the "需要确认换料" hint and
 * a ranking signal; they never add reusable quantity.
 */
export function recommendSamplePlanCompanions(input: {
  main: SamplePlanningSample;
  candidates: readonly SamplePlanningSample[];
  limit: number;
  /** Fixed clock for deterministic trial calculations. */
  now?: Date;
}): SamplePlanCompanionRecommendationResult {
  if (!Number.isInteger(input.limit) || input.limit < 0) {
    throw new Error("推荐样品数量必须为非负整数");
  }
  if (input.main.materials.length === 0) {
    throw new Error(`${input.main.name} 还没有花材搭配`);
  }
  const mainMaterialIds = new Set(input.main.materials.map((material) => material.materialId));
  const seen = new Set<string>([input.main.sampleId]);
  const now = input.now ?? new Date("2026-01-01T00:00:00.000Z");
  const entries: {
    recommendation: SamplePlanCompanionRecommendation;
    priority: number;
  }[] = [];

  for (const candidate of input.candidates) {
    if (!candidate.sampleId || seen.has(candidate.sampleId)) continue;
    if (candidate.materials.length === 0) continue;
    seen.add(candidate.sampleId);

    const trial = calculateSamplePlan({
      samples: [input.main, candidate],
      selections: [
        { sampleId: input.main.sampleId, quantity: 1, mandatory: true, sequenceNo: 1 },
        { sampleId: candidate.sampleId, quantity: 1, mandatory: false, sequenceNo: 2 },
      ],
      maxSuggestions: 1,
      maxSteps: 2,
      autoSchedule: false,
      now,
    });
    const candidateStep = trial.runs[0]?.steps[1];
    if (!candidateStep) continue;

    let requiredQty = 0;
    let reusedQty = 0;
    const materials: SamplePlanCompanionMaterial[] = [];
    for (const material of candidateStep.materials) {
      const remainingQty = roundQty(
        Math.max(0, material.requiredQty - material.reusedQty),
        material.quantityScale,
      );
      materials.push({
        materialId: material.materialId,
        name: material.materialNameSnapshot,
        baseUnit: material.baseUnit,
        requiredQty: material.requiredQty,
        reusedQty: material.reusedQty,
        remainingQty,
      });
      requiredQty += material.requiredQty;
      reusedQty += material.reusedQty;
    }
    requiredQty = roundQty(requiredQty, 3);
    reusedQty = roundQty(reusedQty, 3);
    materials.sort((left, right) =>
      right.reusedQty - left.reusedQty
      || right.requiredQty - left.requiredQty
      || left.name.localeCompare(right.name)
    );

    entries.push({
      recommendation: {
        sampleId: candidate.sampleId,
        code: candidate.code,
        name: candidate.name,
        requiredQty,
        reusedQty,
        reuseRate: requiredQty > 0 ? roundRate(reusedQty / requiredQty) : 0,
        materials,
        requiresSubstitution: candidate.materials.some(
          (material) => !mainMaterialIds.has(material.materialId),
        ),
        classificationTier: bestClassificationTier(input.main, candidate),
        baseUnit: sharedBaseUnit(candidate.materials),
      },
      priority: candidate.priority,
    });
  }

  entries.sort((left, right) => {
    const a = left.recommendation;
    const b = right.recommendation;
    if (a.reuseRate !== b.reuseRate) return b.reuseRate - a.reuseRate;
    if (a.reusedQty !== b.reusedQty) return b.reusedQty - a.reusedQty;
    const aTier = a.classificationTier ? CLASSIFICATION_RANK[a.classificationTier] : 0;
    const bTier = b.classificationTier ? CLASSIFICATION_RANK[b.classificationTier] : 0;
    if (aTier !== bTier) return bTier - aTier;
    if (left.priority !== right.priority) return right.priority - left.priority;
    return a.code.localeCompare(b.code);
  });

  return {
    candidates: entries.slice(0, input.limit).map((entry) => entry.recommendation),
    eligibleCount: entries.length,
    requestedCount: input.limit,
  };
}

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
  /** Resolved per-plan photography / retention constraints. */
  photoDueAt: Date | null;
  retentionUntil: Date | null;
  /** Stable original position used by the auto scheduler. */
  orderIndex: number;
};

function dateTime(value: Date | string | null | undefined, label: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}无效`);
  return parsed;
}

function scheduleConstraint(selection: NormalizedSelection): boolean {
  return selection.photoDueAt !== null || selection.retentionUntil !== null;
}

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

type ResolvedClassification = {
  flowerVariety: string;
  flowerProductName: string | null;
  color: string | null;
};

function classificationOf(material: SamplePlanningMaterial): ResolvedClassification | null {
  const variety = typeof material.flowerVariety === "string" ? material.flowerVariety.trim() : "";
  if (!variety) return null;
  const productName = typeof material.flowerProductName === "string"
    ? material.flowerProductName.trim()
    : "";
  const color = typeof material.color === "string" ? material.color.trim() : "";
  return {
    flowerVariety: variety,
    flowerProductName: productName || null,
    color: color || null,
  };
}

const CLASSIFICATION_RANK: Record<SamplePlanClassificationTier, number> = {
  exact: 3,
  varietyColor: 2,
  variety: 1,
};

/**
 * Strongest classification link between a required material and a candidate
 * material. Batch 2 adds the third tier: same 种类 only. A missing variety is
 * never treated as a wildcard, so unclassified data falls back to the other
 * ranking signals.
 */
function classificationTier(
  required: SamplePlanningMaterial,
  candidate: SamplePlanningMaterial,
): SamplePlanClassificationTier | null {
  const left = classificationOf(required);
  const right = classificationOf(candidate);
  if (!left || !right) return null;
  if (left.flowerVariety !== right.flowerVariety) return null;
  if (left.color && right.color && left.color === right.color) {
    return left.flowerProductName && left.flowerProductName === right.flowerProductName
      ? "exact"
      : "varietyColor";
  }
  return "variety";
}

type SuggestionScore = Omit<SamplePlanSuggestionReason, "sampleId" | "masterSampleId">;

function suggestionScore(
  candidate: SamplePlanningSample,
  master: NormalizedSelection,
): SuggestionScore {
  const requiredMaterials = master.sample.materials;
  const requiredIds = new Set(requiredMaterials.map((material) => material.materialId));
  const matches = new Map<string, SamplePlanClassificationMatch>();
  let overlap = 0;
  let exactClass = 0;
  let varietyColor = 0;
  let varietyClass = 0;
  let inStock = 0;

  for (const material of candidate.materials) {
    if (requiredIds.has(material.materialId)) overlap += 1;
    if (material.availableQty > 0) inStock += 1;

    let bestTier: SamplePlanClassificationTier | null = null;
    for (const required of requiredMaterials) {
      const tier = classificationTier(required, material);
      if (!tier) continue;
      if (bestTier === null || CLASSIFICATION_RANK[tier] > CLASSIFICATION_RANK[bestTier]) {
        bestTier = tier;
      }
      const classification = classificationOf(required);
      if (!classification) continue;
      const key = `${classification.flowerVariety}|${classification.flowerProductName ?? ""}|${classification.color ?? ""}`;
      const existing = matches.get(key);
      if (!existing || CLASSIFICATION_RANK[tier] > CLASSIFICATION_RANK[existing.tier]) {
        matches.set(key, {
          flowerVariety: classification.flowerVariety,
          flowerProductName: classification.flowerProductName,
          color: classification.color,
          tier,
        });
      }
    }
    if (bestTier === "exact") exactClass += 1;
    else if (bestTier === "varietyColor") varietyColor += 1;
    else if (bestTier === "variety") varietyClass += 1;
  }

  return {
    overlap,
    exactClass,
    varietyColor,
    ...(varietyClass > 0 ? { varietyClass } : {}),
    inStock,
    matchedClassifications: [...matches.values()].sort((left, right) =>
      left.flowerVariety.localeCompare(right.flowerVariety)
      || (left.flowerProductName ?? "").localeCompare(right.flowerProductName ?? "")
      || (left.color ?? "").localeCompare(right.color ?? "")
      || right.tier.localeCompare(left.tier)
    ),
  };
}

function scoreSuggestion(
  selection: NormalizedSelection,
  master: NormalizedSelection,
): SuggestionScore {
  return suggestionScore(selection.sample, master);
}

function compareSuggestion(
  left: { selection: NormalizedSelection; score: SuggestionScore },
  right: { selection: NormalizedSelection; score: SuggestionScore },
): number {
  if (left.score.overlap !== right.score.overlap) return right.score.overlap - left.score.overlap;
  if (left.score.exactClass !== right.score.exactClass) {
    return right.score.exactClass - left.score.exactClass;
  }
  if (left.score.varietyColor !== right.score.varietyColor) {
    return right.score.varietyColor - left.score.varietyColor;
  }
  if ((left.score.varietyClass ?? 0) !== (right.score.varietyClass ?? 0)) {
    return (right.score.varietyClass ?? 0) - (left.score.varietyClass ?? 0);
  }
  if (left.score.inStock !== right.score.inStock) return right.score.inStock - left.score.inStock;
  if (left.selection.sample.priority !== right.selection.sample.priority) {
    return right.selection.sample.priority - left.selection.sample.priority;
  }
  return left.selection.sample.code.localeCompare(right.selection.sample.code);
}

/**
 * Multi-master candidate sequences (batch 2):
 * - every mandatory (master) sample, in the configured order;
 * - plus the best optional match for each master, appended in master order.
 *
 * Each master independently chooses its best unmatched optional sample by
 * material overlap → exact classification → variety+color → variety only →
 * stock → priority → code. Up to `maxSuggestions - 1` suggestions are exposed
 * as progressively larger candidate runs. A plan with one master keeps the
 * batch-1 behaviour; a plan with several masters now receives suggestions too.
 */
function buildCandidateSequences(
  base: readonly NormalizedSelection[],
  mandatory: readonly NormalizedSelection[],
  optional: readonly NormalizedSelection[],
  maxSuggestions: number,
  maxSteps: number,
): { sequences: NormalizedSelection[][]; matches: { selection: NormalizedSelection; master: NormalizedSelection }[] } {
  const baseSequence = sortBySequence(base);
  if (optional.length === 0) return { sequences: [baseSequence], matches: [] };

  const availableSlots = Math.max(0, maxSteps - base.length);
  const suggestionLimit = Math.min(
    availableSlots,
    Math.max(0, Math.max(1, maxSuggestions) - 1),
  );
  const used = new Set(base.map((selection) => selection.sample.sampleId));
  const matches: { selection: NormalizedSelection; master: NormalizedSelection }[] = [];

  if (mandatory.length === 1) {
    // Single master: expose the best N optional samples as progressive runs,
    // preserving the batch-1 ranking behaviour.
    const master = mandatory[0]!;
    const ranked = optional
      .map((selection) => ({ selection, score: scoreSuggestion(selection, master) }))
      .sort(compareSuggestion)
      .slice(0, suggestionLimit);
    for (const entry of ranked) {
      matches.push({ selection: entry.selection, master });
    }
  } else {
    // Multi-master: each master independently receives at most one unmatched
    // optional companion.
    for (const master of sortBySequence(mandatory)) {
      const ranked = optional
        .filter((selection) => !used.has(selection.sample.sampleId))
        .map((selection) => ({
          selection,
          score: scoreSuggestion(selection, master),
        }))
        .sort(compareSuggestion);
      const best = ranked[0];
      if (!best) continue;
      used.add(best.selection.sample.sampleId);
      matches.push({ selection: best.selection, master });
    }
  }

  const sequences: NormalizedSelection[][] = [baseSequence];
  const capped = matches.slice(0, suggestionLimit);
  for (let count = 1; count <= capped.length; count += 1) {
    sequences.push([
      ...baseSequence,
      ...capped.slice(0, count).map(({ selection }) => ({ ...selection, sequenceNo: 0 })),
    ]);
  }

  const seen = new Set<string>();
  return {
    sequences: sequences.filter((sequence) => {
      const key = sequence.map((selection) => selection.sample.sampleId).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    matches,
  };
}

/**
 * Auto schedule order (batch 2). A sequence with no photography/retention
 * constraint keeps the user's order. Otherwise:
 * 1. earlier photography deadlines first;
 * 2. retained samples last (so their material is not disassembled);
 * 3. the original configured order as a stable tie-break.
 *
 * A conflicted plan (a retained sample that also has the earliest photo
 * deadline) is not silently "fixed": the generated warnings surface it so the
 * employee can adjust dates or order.
 */
function scheduleOrder(
  sequence: readonly NormalizedSelection[],
  autoSchedule: boolean,
): NormalizedSelection[] {
  if (!autoSchedule || !sequence.some(scheduleConstraint)) return [...sequence];
  return [...sequence].sort((left, right) => {
    const leftPhoto = left.photoDueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightPhoto = right.photoDueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftPhoto !== rightPhoto) return leftPhoto - rightPhoto;
    const leftRetained = left.retentionUntil === null ? 0 : 1;
    const rightRetained = right.retentionUntil === null ? 0 : 1;
    if (leftRetained !== rightRetained) return leftRetained - rightRetained;
    return left.orderIndex - right.orderIndex;
  });
}

type BuiltSchedule = {
  schedule: SamplePlanSchedule;
  stepWarnings: string[][];
};

function buildSchedule(
  sequence: readonly NormalizedSelection[],
  autoSchedule: boolean,
  now: Date,
  stepDurationMinutes: number,
): BuiltSchedule {
  const autoScheduled = autoSchedule && sequence.some(scheduleConstraint);
  const startAt = now.getTime();
  let cursor = startAt;
  const warnings: string[] = [];
  const steps: SamplePlanScheduleStep[] = [];
  const stepWarnings: string[][] = [];

  sequence.forEach((selection, index) => {
    const plannedStartAt = new Date(cursor);
    cursor += stepDurationMinutes * 60_000;
    const plannedEndAt = new Date(cursor);
    const retained = index === sequence.length - 1;
    const currentWarnings: string[] = [];

    if (selection.photoDueAt && plannedEndAt.getTime() > selection.photoDueAt.getTime()) {
      currentWarnings.push(
        `第 ${index + 1} 步「${selection.sample.name}」预计完成晚于拍摄截止时间`,
      );
    }
    if (selection.retentionUntil && !retained) {
      currentWarnings.push(
        `「${selection.sample.name}」需要留样，但排在非末步，拆解后无法保留`,
      );
    }
    if (
      retained &&
      selection.retentionUntil &&
      plannedEndAt.getTime() > selection.retentionUntil.getTime()
    ) {
      currentWarnings.push(
        `末步「${selection.sample.name}」预计完成晚于留样截止时间`,
      );
    }
    if (currentWarnings.length > 0) warnings.push(...currentWarnings);
    stepWarnings.push(currentWarnings);
    steps.push({
      sequenceNo: index + 1,
      sampleId: selection.sample.sampleId,
      sampleName: selection.sample.name,
      plannedStartAt: plannedStartAt.toISOString(),
      plannedEndAt: plannedEndAt.toISOString(),
      photoDueAt: selection.photoDueAt?.toISOString() ?? null,
      retentionUntil: selection.retentionUntil?.toISOString() ?? null,
      retained,
      warnings: currentWarnings,
    });
  });

  return {
    schedule: {
      autoScheduled,
      warnings: [...new Set(warnings)],
      steps,
    },
    stepWarnings,
  };
}

export function calculateSamplePlan(
  input: SamplePlanCalculationInput,
): SamplePlanCalculationResult {
  const warnings: string[] = [];
  const maxSteps = input.maxSteps ?? SAMPLE_PLAN_DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) throw new Error("最大打样步骤数必须为正整数");
  const maxSuggestionsInput = input.maxSuggestions;
  if (maxSuggestionsInput !== undefined &&
      (!Number.isInteger(maxSuggestionsInput) || maxSuggestionsInput <= 0)) {
    throw new Error("最大推荐方案数必须为正整数");
  }
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

  const autoSchedule = input.autoSchedule !== false;
  const now = dateTime(input.now ?? new Date(), "排程起始时间")!;
  const stepDurationMinutes = input.stepDurationMinutes ?? 60;
  if (!Number.isFinite(stepDurationMinutes) || stepDurationMinutes <= 0) {
    throw new Error("单步排程时长必须大于零");
  }

  const normalized: NormalizedSelection[] = input.selections.map((selection, index) => {
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
      photoDueAt: dateTime(
        selection.photoDueAt !== undefined ? selection.photoDueAt : sample.photoDueAt,
        `${sample.name} 的拍摄截止时间`,
      ),
      retentionUntil: dateTime(
        selection.retentionUntil !== undefined
          ? selection.retentionUntil
          : sample.retentionUntil,
        `${sample.name} 的留样截止时间`,
      ),
      orderIndex: index,
    };
  });

  const mandatory = normalized.filter((selection) => selection.mandatory);
  if (mandatory.length === 0) throw new Error("打样计划至少需要一个必选样品");
  if (normalized.length > maxSteps) {
    throw new Error(`打样步骤不能超过 ${maxSteps} 步`);
  }
  // Multi-master plans should be able to expose one companion candidate per
  // master by default, while single-master plans keep the batch-1 default.
  const maxSuggestions = maxSuggestionsInput
    ?? Math.max(SAMPLE_PLAN_DEFAULT_MAX_SUGGESTIONS, mandatory.length + 1);

  const selectedIds = new Set(normalized.map((selection) => selection.sample.sampleId));
  const optional: NormalizedSelection[] = input.samples
    .filter((sample) => !selectedIds.has(sample.sampleId) && sample.materials.length > 0)
    .map((sample, index) => ({
      sample,
      quantity: 1,
      mandatory: false,
      sequenceNo: Number.MAX_SAFE_INTEGER,
      photoDueAt: dateTime(sample.photoDueAt, `${sample.name} 的拍摄截止时间`),
      retentionUntil: dateTime(sample.retentionUntil, `${sample.name} 的留样截止时间`),
      orderIndex: normalized.length + index,
    }));

  const candidateResult = buildCandidateSequences(
    normalized,
    mandatory,
    optional,
    maxSuggestions,
    maxSteps,
  );
  const sequences = candidateResult.sequences;
  if (mandatory.length > 1 && optional.length > 0 && candidateResult.matches.length === 0) {
    warnings.push("多个必选样品没有找到可追加的搭配样品，已仅按必选样品排程。");
  }
  const runs: SamplePlanRunResult[] = [];

  for (const sequence of sequences) {
    const scheduledSequence = scheduleOrder(sequence, autoSchedule);
    const built = buildSchedule(scheduledSequence, autoSchedule, now, stepDurationMinutes);
    const stockRemaining = new Map<string, number>();
    const pool = new Map<string, number>();
    const materialInfo = new Map<string, SamplePlanningMaterial>();
    let independentCost = 0;
    let totalCost = 0;
    let reusedCost = 0;
    let inputCost = 0;
    let totalRequired = 0;

    const steps: SamplePlanStepResult[] = scheduledSequence.map((selection, index) => {
      const isLast = index === scheduledSequence.length - 1;
      const stepMaterials: SamplePlanMaterialFlow[] = [];
      let stepCost = 0;

      for (const material of selection.sample.materials) {
        const requiredQty = roundQty(
          material.quantity * selection.quantity,
          material.quantityScale,
        );
        if (requiredQty <= 0) continue;

        materialInfo.set(material.materialId, material);

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
        // Ideal scenario: production and disassembly add no loss. An
        // intermediate sample releases all of its input; the retained last
        // sample releases nothing but still has zero expected loss.
        const reusableQty = isLast ? 0 : inputQty;
        const lossQty = 0;
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
          reusableRate: isLast ? 0 : SAMPLE_PLAN_IDEAL_REUSE_RATE,
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
        plannedStartAt: built.schedule.steps[index]!.plannedStartAt,
        plannedEndAt: built.schedule.steps[index]!.plannedEndAt,
        photoDueAt: built.schedule.steps[index]!.photoDueAt,
        retentionUntil: built.schedule.steps[index]!.retentionUntil,
        retained: built.schedule.steps[index]!.retained,
        scheduleWarnings: built.stepWarnings[index] ?? [],
      };
    });

    const inventory = [...materialInfo.values()]
      .sort((left, right) => left.materialId.localeCompare(right.materialId))
      .map((material) => ({
        materialId: material.materialId,
        availableQty: material.availableQty,
        unitCost: material.unitCost,
        unitSnapshot: `${material.availableQty}${material.baseUnit} 可用 · ¥${material.unitCost.toFixed(4)}/${material.baseUnit} · 理想复用 100%`,
      }));

    const reuseRate = inputCost > 0 ? clampRate(reusedCost / inputCost, 0) : 0;
    const matchBySampleId = new Map(
      candidateResult.matches.map((match) => [match.selection.sample.sampleId, match]),
    );
    const fallbackMaster = mandatory[0]!;
    runs.push({
      rank: 0,
      algorithmVersion: SAMPLE_PLAN_ALGORITHM_VERSION,
      requestedSampleCount: scheduledSequence.reduce((sum, selection) => sum + selection.quantity, 0),
      steps,
      schedule: built.schedule,
      inventory,
      independentCost: roundMoney(independentCost),
      totalCost: roundMoney(totalCost),
      estimatedSaving: roundMoney(Math.max(0, independentCost - totalCost)),
      reuseRate: roundRate(reuseRate),
      candidateSnapshot: {
        samples: scheduledSequence.map((selection, index) => ({
          sampleId: selection.sample.sampleId,
          code: selection.sample.code,
          name: selection.sample.name,
          quantity: selection.quantity,
          mandatory: selection.mandatory,
          sequenceNo: index + 1,
        })),
        suggestedSampleIds: scheduledSequence
          .filter((selection) => !selection.mandatory)
          .map((selection) => selection.sample.sampleId),
        suggestedSampleReasons: scheduledSequence
          .filter((selection) => !selection.mandatory)
          .map((selection) => ({
            sampleId: selection.sample.sampleId,
            masterSampleId:
              matchBySampleId.get(selection.sample.sampleId)?.master.sample.sampleId
              ?? fallbackMaster.sample.sampleId,
            ...suggestionScore(
              selection.sample,
              matchBySampleId.get(selection.sample.sampleId)?.master ?? fallbackMaster,
            ),
          })),
      },
      lossPolicySnapshot: {
        defaultReusableRate: SAMPLE_PLAN_IDEAL_REUSE_RATE,
        byMaterialId: Object.fromEntries(
          [...materialInfo.keys()]
            .sort((left, right) => left.localeCompare(right))
            .map((materialId) => [materialId, SAMPLE_PLAN_IDEAL_REUSE_RATE]),
        ),
      },
    });

    for (const warning of built.schedule.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
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

  return { runs, warnings: [...new Set(warnings)] };
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
