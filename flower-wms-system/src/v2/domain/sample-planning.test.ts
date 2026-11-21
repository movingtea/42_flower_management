import assert from "node:assert/strict";
import {
  SAMPLE_PLAN_ALGORITHM_VERSION,
  calculateSamplePlan,
  isIdealReuseAlgorithmVersion,
  recommendSamplePlanCompanions,
  sampleMaterialCost,
  type SamplePlanningSample,
} from "./sample-planning";

function flower(
  materialId: string,
  options: {
    quantity: number;
    availableQty: number;
    unitCost?: number;
    reusableRate?: number;
    scale?: number;
    variety?: string | null;
    productName?: string | null;
    color?: string | null;
  },
): SamplePlanningSample["materials"][number] {
  return {
    materialId,
    name: `物料-${materialId}`,
    grade: "A",
    baseUnit: "支",
    quantityScale: options.scale ?? 0,
    quantity: options.quantity,
    unitCost: options.unitCost ?? 2,
    availableQty: options.availableQty,
    reusableRate: options.reusableRate ?? 0.5,
    flowerVariety: options.variety ?? null,
    flowerProductName: options.productName ?? null,
    color: options.color ?? null,
  };
}

function sample(
  sampleId: string,
  materials: SamplePlanningSample["materials"],
  priority = 0,
): SamplePlanningSample {
  return {
    sampleId,
    code: `SMP-${sampleId}`,
    name: `样品-${sampleId}`,
    priority,
    materials,
  };
}

function main(): void {
  // Persisted legacy runs stay on their old version and must not be labelled as
  // ideal by the page.
  assert.equal(isIdealReuseAlgorithmVersion(SAMPLE_PLAN_ALGORITHM_VERSION), true);
  assert.equal(isIdealReuseAlgorithmVersion("sample-plan-v3-ideal-reuse"), true);
  assert.equal(isIdealReuseAlgorithmVersion("sample-plan-v2"), false);

  // A single retained sample: no disassembly, so no reusable pool and no loss forecast.
  const solo = calculateSamplePlan({
    samples: [sample("A", [flower("rose", { quantity: 10, availableQty: 20 })])],
    selections: [{ sampleId: "A", quantity: 1, mandatory: true }],
  });
  assert.equal(solo.runs.length, 1);
  const soloRun = solo.runs[0]!;
  assert.equal(soloRun.algorithmVersion, SAMPLE_PLAN_ALGORITHM_VERSION);
  assert.equal(soloRun.steps.length, 1);
  assert.equal(soloRun.steps[0]!.materials[0]!.stockQty, 10);
  assert.equal(soloRun.steps[0]!.materials[0]!.reusedQty, 0);
  assert.equal(soloRun.steps[0]!.materials[0]!.purchaseQty, 0);
  assert.equal(soloRun.steps[0]!.materials[0]!.reusableAfterDisassemblyQty, 0);
  assert.equal(soloRun.totalCost, 20);
  assert.equal(soloRun.independentCost, 20);
  assert.equal(soloRun.estimatedSaving, 0);
  assert.equal(soloRun.reuseRate, 0);

  // Two mandatory samples: the first is disassembled, its fully released input
  // feeds the second, and only the remaining requirement is bought. The legacy
  // material rate is deliberately 0.5 to prove the ideal forecast ignores it.
  const pair = calculateSamplePlan({
    samples: [
      sample("A", [flower("rose", { quantity: 10, availableQty: 12, reusableRate: 0.5 })]),
      sample("B", [flower("rose", { quantity: 6, availableQty: 12, reusableRate: 0.5 })]),
    ],
    selections: [
      { sampleId: "A", quantity: 1, mandatory: true, sequenceNo: 1 },
      { sampleId: "B", quantity: 1, mandatory: true, sequenceNo: 2 },
    ],
    defaultReusableRate: 0.5,
  });
  assert.equal(pair.runs.length, 1);
  const pairRun = pair.runs[0]!;
  assert.equal(pairRun.steps.length, 2);
  assert.equal(pairRun.steps[0]!.materials[0]!.reusableAfterDisassemblyQty, 10);
  assert.equal(pairRun.steps[0]!.materials[0]!.lossQty, 0);
  assert.equal(pairRun.steps[1]!.materials[0]!.reusedQty, 6);
  assert.equal(pairRun.steps[1]!.materials[0]!.stockQty, 0);
  assert.equal(pairRun.steps[1]!.materials[0]!.purchaseQty, 0);
  assert.equal(pairRun.totalCost, 20);
  assert.equal(pairRun.independentCost, 32);
  assert.equal(pairRun.estimatedSaving, 12);
  assert.equal(pairRun.reuseRate, 0.375);

  // 003 -> 059 ideal case from the confirmed first batch: zero stock, 15 stems
  // then 20 stems. The later step reuses all 15 and only needs 5 qualified
  // stems. Both configured rates are non-ideal to prove they are ignored.
  const idealPair = calculateSamplePlan({
    samples: [
      sample("003", [flower("rose-highland", {
        quantity: 15,
        availableQty: 0,
        reusableRate: 0.5,
      })]),
      sample("059", [flower("rose-highland", {
        quantity: 20,
        availableQty: 0,
        reusableRate: 0.5,
      })]),
    ],
    selections: [
      { sampleId: "003", quantity: 1, mandatory: true, sequenceNo: 1 },
      { sampleId: "059", quantity: 1, mandatory: true, sequenceNo: 2 },
    ],
    defaultReusableRate: 0.9,
  });
  const idealRun = idealPair.runs[0]!;
  assert.equal(idealRun.algorithmVersion, SAMPLE_PLAN_ALGORITHM_VERSION);
  assert.equal(idealRun.steps[0]!.materials[0]!.stockQty, 0);
  assert.equal(idealRun.steps[0]!.materials[0]!.purchaseQty, 15);
  assert.equal(idealRun.steps[0]!.materials[0]!.reusableAfterDisassemblyQty, 15);
  assert.equal(idealRun.steps[0]!.materials[0]!.lossQty, 0);
  assert.equal(idealRun.steps[1]!.materials[0]!.reusedQty, 15);
  assert.equal(idealRun.steps[1]!.materials[0]!.purchaseQty, 5);
  assert.equal(idealRun.steps[1]!.materials[0]!.reusableAfterDisassemblyQty, 0);
  assert.equal(idealRun.steps[1]!.materials[0]!.lossQty, 0);
  assert.equal(idealRun.totalCost, 40);
  assert.equal(idealRun.independentCost, 70);
  assert.equal(idealRun.estimatedSaving, 30);
  assert.equal(idealRun.lossPolicySnapshot.defaultReusableRate, 1);
  assert.deepEqual(idealRun.lossPolicySnapshot.byMaterialId, { "rose-highland": 1 });
  assert.match(idealRun.inventory[0]!.unitSnapshot, /理想复用 100%/);

  // Three steps: released material is only available after that step is
  // disassembled, and each release joins the pool once. A releases 10, B takes
  // 6 and releases 6 (pool 4 + 6 = 10), so C can reuse 10 and needs 10 more.
  const chain = calculateSamplePlan({
    samples: [
      sample("A", [flower("rose", { quantity: 10, availableQty: 0 })]),
      sample("B", [flower("rose", { quantity: 6, availableQty: 0 })]),
      sample("C", [flower("rose", { quantity: 20, availableQty: 0 })]),
    ],
    selections: [
      { sampleId: "A", quantity: 1, mandatory: true, sequenceNo: 1 },
      { sampleId: "B", quantity: 1, mandatory: true, sequenceNo: 2 },
      { sampleId: "C", quantity: 1, mandatory: true, sequenceNo: 3 },
    ],
  });
  const chainRun = chain.runs[0]!;
  assert.equal(chainRun.steps[0]!.materials[0]!.purchaseQty, 10);
  assert.equal(chainRun.steps[0]!.materials[0]!.reusableAfterDisassemblyQty, 10);
  assert.equal(chainRun.steps[1]!.materials[0]!.reusedQty, 6);
  assert.equal(chainRun.steps[1]!.materials[0]!.purchaseQty, 0);
  assert.equal(chainRun.steps[1]!.materials[0]!.reusableAfterDisassemblyQty, 6);
  assert.equal(chainRun.steps[2]!.materials[0]!.reusedQty, 10);
  assert.equal(chainRun.steps[2]!.materials[0]!.purchaseQty, 10);
  assert.equal(chainRun.steps[2]!.materials[0]!.reusableAfterDisassemblyQty, 0);
  assert.equal(chainRun.steps[2]!.materials[0]!.lossQty, 0);
  assert.equal(chainRun.totalCost, 40);
  assert.equal(chainRun.reuseRate, 0.4444);

  // The optional candidate overlaps the mandatory material and is suggested.
  const withSuggestion = calculateSamplePlan({
    samples: [
      sample("A", [flower("rose", { quantity: 10, availableQty: 20 })]),
      sample("B", [flower("rose", { quantity: 5, availableQty: 20 })], 5),
      sample("C", [flower("tulip", { quantity: 5, availableQty: 20 })], 1),
    ],
    selections: [{ sampleId: "A", quantity: 1, mandatory: true }],
  });
  assert.equal(withSuggestion.runs.length, 2);
  assert.equal(withSuggestion.runs[0]!.steps.length, 2);
  assert.deepEqual(withSuggestion.runs[0]!.candidateSnapshot.suggestedSampleIds, ["B"]);
  assert.equal(withSuggestion.runs[0]!.totalCost, 20);
  assert.equal(withSuggestion.runs[0]!.estimatedSaving, 10);
  assert.equal(withSuggestion.runs[1]!.steps.length, 1);

  // A non-mandatory item explicitly selected by the user is still simulated;
  // "mandatory" only controls whether the algorithm may add unselected samples.
  const explicitOptional = calculateSamplePlan({
    samples: [
      sample("A", [flower("rose", { quantity: 10, availableQty: 20 })]),
      sample("B", [flower("rose", { quantity: 5, availableQty: 20 })]),
    ],
    selections: [
      { sampleId: "A", quantity: 1, mandatory: true, sequenceNo: 1 },
      { sampleId: "B", quantity: 1, mandatory: false, sequenceNo: 2 },
    ],
  });
  assert.equal(explicitOptional.runs.length, 1);
  assert.equal(explicitOptional.runs[0]!.steps.length, 2);
  assert.equal(explicitOptional.runs[0]!.steps[1]!.materials[0]!.reusedQty, 5);

  // Batch 2: multiple mandatory (master) samples each receive their own
  // optional suggestion instead of disabling suggestions entirely.
  const multiMaster = calculateSamplePlan({
    samples: [
      sample("A", [flower("rose", { quantity: 10, availableQty: 20 })]),
      sample("B", [flower("rose", { quantity: 5, availableQty: 20 })]),
      sample("C", [flower("rose", { quantity: 5, availableQty: 20 })]),
    ],
    selections: [
      { sampleId: "A", quantity: 1, mandatory: true, sequenceNo: 1 },
      { sampleId: "B", quantity: 1, mandatory: true, sequenceNo: 2 },
    ],
  });
  assert.equal(multiMaster.runs.length, 2);
  const multiBase = multiMaster.runs.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length === 0,
  )!;
  assert.equal(multiBase.steps.length, 2);
  const multiSuggested = multiMaster.runs.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length > 0,
  )!;
  assert.deepEqual(multiSuggested.candidateSnapshot.suggestedSampleIds, ["C"]);
  assert.equal(multiSuggested.candidateSnapshot.suggestedSampleReasons[0]!.masterSampleId, "A");

  // Material quantity scaling is respected and a requested quantity is multiplied.
  const scaled = calculateSamplePlan({
    samples: [sample("A", [flower("ribbon", { quantity: 2.5, availableQty: 10, scale: 1 })])],
    selections: [{ sampleId: "A", quantity: 3, mandatory: true }],
  });
  assert.equal(scaled.runs[0]!.steps[0]!.materials[0]!.requiredQty, 7.5);

  // Flower classification ranking: a candidate whose materials share the full
  // 种类+颜色+商品名 classification outranks a 种类+颜色 match, and both
  // outrank priority/stock-only candidates. Ranking never creates real reuse:
  // a different materialId still has to be purchased.
  const classified = calculateSamplePlan({
    maxSuggestions: 3,
    samples: [
      sample("A", [flower("rose-a", {
        quantity: 10,
        availableQty: 20,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "红",
      })]),
      sample("D", [flower("carnation", { quantity: 5, availableQty: 20 })], 10),
      sample("E", [flower("rose-b", {
        quantity: 5,
        availableQty: 0,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "红",
      })], 1),
      sample("F", [flower("rose-c", {
        quantity: 5,
        availableQty: 20,
        variety: "玫瑰",
        color: "红",
      })], 2),
      sample("G", [flower("rose-d", {
        quantity: 5,
        availableQty: 20,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "白",
      })], 20),
    ],
    selections: [{ sampleId: "A", quantity: 1, mandatory: true }],
  });
  assert.equal(classified.runs.length, 3);
  const baseRun = classified.runs.find((run) => run.candidateSnapshot.suggestedSampleIds.length === 0)!;
  assert.equal(baseRun.totalCost, 20);
  assert.deepEqual(baseRun.candidateSnapshot.suggestedSampleReasons, []);

  const suggestionRuns = classified.runs.filter(
    (run) => run.candidateSnapshot.suggestedSampleIds.length > 0,
  );
  assert.equal(suggestionRuns.length, 2);
  const oneSuggestion = suggestionRuns.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length === 1,
  )!;
  assert.deepEqual(oneSuggestion.candidateSnapshot.suggestedSampleIds, ["E"]);
  assert.deepEqual(oneSuggestion.candidateSnapshot.suggestedSampleReasons, [{
    sampleId: "E",
    masterSampleId: "A",
    overlap: 0,
    exactClass: 1,
    varietyColor: 0,
    inStock: 0,
    matchedClassifications: [{
      flowerVariety: "玫瑰",
      flowerProductName: "玛格丽特",
      color: "红",
      tier: "exact",
    }],
  }]);
  // 分类只影响推荐排序：materialId 不同，复用仍为 0，按需采购。
  assert.equal(oneSuggestion.steps[1]!.materials[0]!.reusedQty, 0);
  assert.equal(oneSuggestion.steps[1]!.materials[0]!.purchaseQty, 5);
  assert.equal(oneSuggestion.totalCost, 30);
  assert.equal(oneSuggestion.independentCost, 30);

  const twoSuggestions = suggestionRuns.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length === 2,
  )!;
  assert.deepEqual(twoSuggestions.candidateSnapshot.suggestedSampleIds, ["E", "F"]);
  assert.deepEqual(twoSuggestions.candidateSnapshot.suggestedSampleReasons[1], {
    sampleId: "F",
    masterSampleId: "A",
    overlap: 0,
    exactClass: 0,
    varietyColor: 1,
    inStock: 1,
    matchedClassifications: [{
      flowerVariety: "玫瑰",
      flowerProductName: "玛格丽特",
      color: "红",
      tier: "varietyColor",
    }],
  });
  // G 仅颜色不同，虽然优先级最高仍排在分类匹配之后。
  assert.ok(!twoSuggestions.candidateSnapshot.suggestedSampleIds.includes("G"));

  // materialId overlap remains the top signal even when another candidate
  // matches the full flower classification.
  const overlapFirst = calculateSamplePlan({
    samples: [
      sample("A", [flower("rose", {
        quantity: 10,
        availableQty: 20,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "红",
      })]),
      sample("B", [flower("rose", { quantity: 5, availableQty: 20 })], 1),
      sample("C", [flower("rose-alt", {
        quantity: 5,
        availableQty: 20,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "红",
      })], 10),
    ],
    selections: [{ sampleId: "A", quantity: 1, mandatory: true }],
  });
  const overlapRun = overlapFirst.runs.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length > 0,
  )!;
  assert.deepEqual(overlapRun.candidateSnapshot.suggestedSampleIds, ["B"]);
  assert.deepEqual(overlapRun.candidateSnapshot.suggestedSampleReasons[0], {
    sampleId: "B",
    masterSampleId: "A",
    overlap: 1,
    exactClass: 0,
    varietyColor: 0,
    inStock: 1,
    matchedClassifications: [],
  });

  // Empty classification data never matches: the tie falls back to stock,
  // priority and code instead of treating null as a wildcard.
  const noClassification = calculateSamplePlan({
    samples: [
      sample("A", [flower("rose", { quantity: 10, availableQty: 20 })]),
      sample("B", [flower("tulip", { quantity: 5, availableQty: 20 })], 1),
      sample("C", [flower("lily", { quantity: 5, availableQty: 0 })], 9),
    ],
    selections: [{ sampleId: "A", quantity: 1, mandatory: true }],
  });
  const noClassRun = noClassification.runs.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length > 0,
  )!;
  assert.deepEqual(noClassRun.candidateSnapshot.suggestedSampleIds, ["B"]);
  assert.deepEqual(noClassRun.candidateSnapshot.suggestedSampleReasons[0], {
    sampleId: "B",
    masterSampleId: "A",
    overlap: 0,
    exactClass: 0,
    varietyColor: 0,
    inStock: 1,
    matchedClassifications: [],
  });

  // A missing variety or color is never a wildcard: only the fully classified
  // candidate is suggested, and the partially classified ones fall back to
  // priority/code ordering behind it.
  const partialClassification = calculateSamplePlan({
    maxSuggestions: 3,
    samples: [
      sample("A", [flower("rose", {
        quantity: 10,
        availableQty: 20,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "红",
      })]),
      sample("B", [flower("no-variety", {
        quantity: 5,
        availableQty: 20,
        productName: "玛格丽特",
        color: "红",
      })], 9),
      sample("C", [flower("no-color", {
        quantity: 5,
        availableQty: 20,
        variety: "玫瑰",
        productName: "玛格丽特",
      })], 9),
      sample("D", [flower("other-color", {
        quantity: 5,
        availableQty: 20,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "黄",
      })], 9),
      sample("E", [flower("exact-alt", {
        quantity: 5,
        availableQty: 0,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "红",
      })], 0),
    ],
    selections: [{ sampleId: "A", quantity: 1, mandatory: true }],
  });
  const partialRuns = partialClassification.runs.filter(
    (run) => run.candidateSnapshot.suggestedSampleIds.length > 0,
  );
  const partialOne = partialRuns.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length === 1,
  )!;
  assert.deepEqual(partialOne.candidateSnapshot.suggestedSampleIds, ["E"]);
  assert.equal(partialOne.candidateSnapshot.suggestedSampleReasons[0]!.exactClass, 1);
  const partialTwo = partialRuns.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length === 2,
  )!;
  // Batch 2 adds the 种类-only tier. C shares 种类 but has no color, so it now
  // outranks B (no 种类 at all) under the third matching level.
  assert.deepEqual(partialTwo.candidateSnapshot.suggestedSampleIds, ["E", "C"]);
  assert.equal(partialTwo.candidateSnapshot.suggestedSampleReasons[1]!.exactClass, 0);
  assert.equal(partialTwo.candidateSnapshot.suggestedSampleReasons[1]!.varietyColor, 0);
  assert.equal(partialTwo.candidateSnapshot.suggestedSampleReasons[1]!.varietyClass, 1);
  assert.deepEqual(
    partialTwo.candidateSnapshot.suggestedSampleReasons[1]!.matchedClassifications,
    [{
      flowerVariety: "玫瑰",
      flowerProductName: "玛格丽特",
      color: "红",
      tier: "variety",
    }],
  );

  // When no classification or stock difference exists, ranking falls back to
  // priority and then the sample code, so the order is deterministic.
  const fallbackOrder = calculateSamplePlan({
    maxSuggestions: 3,
    samples: [
      sample("A", [flower("rose", { quantity: 10, availableQty: 20 })]),
      sample("B", [flower("tulip", { quantity: 5, availableQty: 20 })], 1),
      sample("C", [flower("lily", { quantity: 5, availableQty: 20 })], 1),
      sample("D", [flower("daisy", { quantity: 5, availableQty: 20 })], 5),
    ],
    selections: [{ sampleId: "A", quantity: 1, mandatory: true }],
  });
  const fallbackRuns = fallbackOrder.runs.filter(
    (run) => run.candidateSnapshot.suggestedSampleIds.length > 0,
  );
  assert.deepEqual(
    fallbackRuns.find((run) => run.candidateSnapshot.suggestedSampleIds.length === 1)!
      .candidateSnapshot.suggestedSampleIds,
    ["D"],
  );
  assert.deepEqual(
    fallbackRuns.find((run) => run.candidateSnapshot.suggestedSampleIds.length === 2)!
      .candidateSnapshot.suggestedSampleIds,
    ["D", "B"],
  );

  // exactClass is compared before varietyColor: one exact match still outranks
  // a candidate with two variety+color matches and a much higher priority.
  const exactCountWins = calculateSamplePlan({
    maxSuggestions: 3,
    samples: [
      sample("A", [
        flower("red-a", { quantity: 5, availableQty: 20, variety: "玫瑰", productName: "玛格丽特", color: "红" }),
        flower("red-b", { quantity: 5, availableQty: 20, variety: "玫瑰", productName: "玛格丽特", color: "红" }),
      ]),
      sample("E", [flower("red-alt", {
        quantity: 5,
        availableQty: 0,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "红",
      })], 0),
      sample("F", [
        flower("pink-alt", { quantity: 5, availableQty: 20, variety: "玫瑰", productName: "粉佳人", color: "红" }),
        flower("white-alt", { quantity: 5, availableQty: 20, variety: "玫瑰", productName: "雪山", color: "红" }),
      ], 20),
    ],
    selections: [{ sampleId: "A", quantity: 1, mandatory: true }],
  });
  const exactCountRuns = exactCountWins.runs.filter(
    (run) => run.candidateSnapshot.suggestedSampleIds.length > 0,
  );
  const exactCountOne = exactCountRuns.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length === 1,
  )!;
  assert.deepEqual(exactCountOne.candidateSnapshot.suggestedSampleIds, ["E"]);
  assert.deepEqual(exactCountOne.candidateSnapshot.suggestedSampleReasons[0], {
    sampleId: "E",
    masterSampleId: "A",
    overlap: 0,
    exactClass: 1,
    varietyColor: 0,
    inStock: 0,
    matchedClassifications: [
      { flowerVariety: "玫瑰", flowerProductName: "玛格丽特", color: "红", tier: "exact" },
    ],
  });
  const exactCountTwo = exactCountRuns.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length === 2,
  )!;
  assert.deepEqual(exactCountTwo.candidateSnapshot.suggestedSampleIds, ["E", "F"]);
  assert.equal(exactCountTwo.candidateSnapshot.suggestedSampleReasons[1]!.varietyColor, 2);

  // Multiple mandatory samples now get a per-master suggestion even when the
  // optional candidate matches the first master's classification.
  const classifiedPair = calculateSamplePlan({
    samples: [
      sample("A", [flower("rose", {
        quantity: 10,
        availableQty: 20,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "红",
      })]),
      sample("B", [flower("tulip", { quantity: 5, availableQty: 20 })]),
      sample("C", [flower("rose-alt", {
        quantity: 5,
        availableQty: 20,
        variety: "玫瑰",
        productName: "玛格丽特",
        color: "红",
      })]),
    ],
    selections: [
      { sampleId: "A", quantity: 1, mandatory: true, sequenceNo: 1 },
      { sampleId: "B", quantity: 1, mandatory: true, sequenceNo: 2 },
    ],
  });
  assert.equal(classifiedPair.runs.length, 2);
  const pairSuggestion = classifiedPair.runs.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length > 0,
  )!;
  assert.deepEqual(pairSuggestion.candidateSnapshot.suggestedSampleIds, ["C"]);
  assert.equal(pairSuggestion.candidateSnapshot.suggestedSampleReasons[0]!.masterSampleId, "A");
  assert.equal(pairSuggestion.candidateSnapshot.suggestedSampleReasons[0]!.exactClass, 1);

  // -------------------------------------------------------------------------
  // Batch 2: multi-master matching and photo/retention auto scheduling
  // -------------------------------------------------------------------------
  const multiMasterMatches = calculateSamplePlan({
    maxSuggestions: 3,
    samples: [
      sample("A", [flower("rose", { quantity: 10, availableQty: 10, variety: "玫瑰", color: "红" })]),
      sample("B", [flower("tulip", { quantity: 10, availableQty: 10, variety: "郁金香", color: "黄" })]),
      sample("C", [flower("rose-alt", { quantity: 5, availableQty: 10, variety: "玫瑰", color: "红" })]),
      sample("D", [flower("tulip-alt", { quantity: 5, availableQty: 10, variety: "郁金香", color: "黄" })]),
    ],
    selections: [
      { sampleId: "A", quantity: 1, mandatory: true, sequenceNo: 1 },
      { sampleId: "B", quantity: 1, mandatory: true, sequenceNo: 2 },
    ],
  });
  const combined = multiMasterMatches.runs.find(
    (run) => run.candidateSnapshot.suggestedSampleIds.length === 2,
  )!;
  assert.deepEqual(combined.candidateSnapshot.suggestedSampleIds, ["C", "D"]);
  assert.deepEqual(
    combined.candidateSnapshot.suggestedSampleReasons.map((reason) => reason.masterSampleId),
    ["A", "B"],
  );

  const now = new Date("2026-11-20T09:00:00.000Z");
  const scheduled = calculateSamplePlan({
    now,
    stepDurationMinutes: 60,
    samples: [
      sample("A", [flower("rose", { quantity: 1, availableQty: 10 })], 20),
      sample("B", [flower("rose", { quantity: 1, availableQty: 10 })], 0),
      sample("C", [flower("rose", { quantity: 1, availableQty: 10 })], 0),
    ],
    selections: [
      { sampleId: "A", quantity: 1, mandatory: true, sequenceNo: 1 },
      {
        sampleId: "B",
        quantity: 1,
        mandatory: true,
        sequenceNo: 2,
        photoDueAt: "2026-11-20T10:30:00.000Z",
      },
      {
        sampleId: "C",
        quantity: 1,
        mandatory: true,
        sequenceNo: 3,
        retentionUntil: "2026-11-25T00:00:00.000Z",
      },
    ],
  });
  const scheduledRun = scheduled.runs[0]!;
  assert.equal(scheduledRun.schedule.autoScheduled, true);
  // B has the earliest photo deadline, so it moves first; C is retained last.
  assert.deepEqual(scheduledRun.steps.map((step) => step.sampleId), ["B", "A", "C"]);
  assert.equal(scheduledRun.steps[0]!.plannedStartAt, "2026-11-20T09:00:00.000Z");
  assert.equal(scheduledRun.steps[0]!.plannedEndAt, "2026-11-20T10:00:00.000Z");
  assert.equal(scheduledRun.steps[0]!.photoDueAt, "2026-11-20T10:30:00.000Z");
  assert.equal(scheduledRun.steps[2]!.retained, true);
  assert.equal(scheduledRun.steps[2]!.retentionUntil, "2026-11-25T00:00:00.000Z");
  assert.deepEqual(scheduledRun.schedule.warnings, []);

  // A retained sample placed before the last step is a real conflict and must
  // surface a warning instead of silently losing the retention.
  const conflict = calculateSamplePlan({
    now,
    autoSchedule: false,
    samples: [
      sample("A", [flower("rose", { quantity: 1, availableQty: 10 })]),
      sample("B", [flower("rose", { quantity: 1, availableQty: 10 })]),
    ],
    selections: [
      {
        sampleId: "A",
        quantity: 1,
        mandatory: true,
        sequenceNo: 1,
        retentionUntil: "2026-11-25T00:00:00.000Z",
      },
      { sampleId: "B", quantity: 1, mandatory: true, sequenceNo: 2 },
    ],
  });
  assert.match(conflict.runs[0]!.schedule.warnings.join(" "), /无法保留/);
  assert.match(conflict.warnings.join(" "), /无法保留/);

  // A photo deadline that cannot be met is reported with the step number.
  const photoConflict = calculateSamplePlan({
    now,
    stepDurationMinutes: 120,
    samples: [sample("A", [flower("rose", { quantity: 1, availableQty: 10 })])],
    selections: [{
      sampleId: "A",
      quantity: 1,
      mandatory: true,
      photoDueAt: "2026-11-20T10:00:00.000Z",
    }],
  });
  assert.match(photoConflict.runs[0]!.steps[0]!.scheduleWarnings.join(" "), /拍摄截止/);
  assert.match(photoConflict.warnings.join(" "), /拍摄截止/);

  // Invalid plans fail before producing a run.
  assert.throws(
    () => calculateSamplePlan({
      samples: [sample("A", [flower("rose", { quantity: 1, availableQty: 1 })])],
      selections: [],
    }),
    /至少需要一个样品/,
  );
  assert.throws(
    () => calculateSamplePlan({
      samples: [sample("A", [flower("rose", { quantity: 1, availableQty: 1 })])],
      selections: [{ sampleId: "A", quantity: 1, mandatory: false }],
    }),
    /至少需要一个必选样品/,
  );
  assert.throws(
    () => calculateSamplePlan({
      samples: [sample("A", [])],
      selections: [{ sampleId: "A", quantity: 1, mandatory: true }],
    }),
    /还没有花材搭配/,
  );
  assert.throws(
    () => calculateSamplePlan({
      samples: [
        sample("A", [flower("rose", { quantity: 1, availableQty: 1 })]),
        sample("B", [flower("rose", { quantity: 1, availableQty: 1 })]),
        sample("C", [flower("rose", { quantity: 1, availableQty: 1 })]),
      ],
      selections: [
        { sampleId: "A", quantity: 1, mandatory: true },
        { sampleId: "B", quantity: 1, mandatory: true },
      ],
      maxSteps: 1,
    }),
    /不能超过 1 步/,
  );

  // Single-main recommendation drawer: every companion is trialled against the
  // main sample independently, ranked by expected reuse rate, and flagged when
  // the recipe needs an employee-confirmed material substitution.
  const recommendationMain = sample("REC-003", [
    flower("rec-rose", {
      quantity: 15,
      availableQty: 0,
      variety: "玫瑰",
      productName: "高原红",
      color: "红",
    }),
  ]);
  const recommendationCandidates = [
    sample("REC-036", [
      flower("rec-rose", {
        quantity: 10,
        availableQty: 0,
        variety: "玫瑰",
        productName: "高原红",
        color: "红",
      }),
      flower("rec-sweetpea", { quantity: 2, availableQty: 0 }),
    ]),
    sample("REC-059", [flower("rec-rose", { quantity: 20, availableQty: 0 })]),
    sample("REC-028", [flower("rec-rose", { quantity: 5, availableQty: 0 })]),
    sample("REC-032", [
      flower("rec-rose", { quantity: 10, availableQty: 0 }),
      flower("rec-tulip", { quantity: 10, availableQty: 0 }),
    ]),
  ];
  const recommendations = recommendSamplePlanCompanions({
    main: recommendationMain,
    candidates: recommendationCandidates,
    limit: 2,
  });
  assert.equal(recommendations.eligibleCount, 4);
  assert.equal(recommendations.requestedCount, 2);
  assert.deepEqual(
    recommendations.candidates.map((row) => row.sampleId),
    ["REC-028", "REC-036"],
  );
  const fullReuse = recommendations.candidates[0]!;
  assert.equal(fullReuse.reuseRate, 1);
  assert.equal(fullReuse.reusedQty, 5);
  assert.equal(fullReuse.requiredQty, 5);
  assert.equal(fullReuse.requiresSubstitution, false);
  assert.equal(fullReuse.baseUnit, "支");
  const partialReuse = recommendations.candidates[1]!;
  assert.equal(partialReuse.reuseRate, 0.8333);
  assert.equal(partialReuse.reusedQty, 10);
  assert.equal(partialReuse.requiredQty, 12);
  assert.equal(partialReuse.requiresSubstitution, true);
  assert.equal(partialReuse.classificationTier, "exact");

  // The expandable breakdown exposes every candidate material: reused rows keep
  // their source quantity and the uncovered remainder is per material.
  assert.deepEqual(fullReuse.materials, [
    {
      materialId: "rec-rose",
      name: "物料-rec-rose",
      baseUnit: "支",
      requiredQty: 5,
      reusedQty: 5,
      remainingQty: 0,
    },
  ]);
  assert.deepEqual(
    partialReuse.materials.map((material) => ({
      materialId: material.materialId,
      requiredQty: material.requiredQty,
      reusedQty: material.reusedQty,
      remainingQty: material.remainingQty,
    })),
    [
      { materialId: "rec-rose", requiredQty: 10, reusedQty: 10, remainingQty: 0 },
      { materialId: "rec-sweetpea", requiredQty: 2, reusedQty: 0, remainingQty: 2 },
    ],
  );
  assert.equal(
    fullReuse.materials.reduce((sum, material) => sum + material.reusedQty, 0),
    fullReuse.reusedQty,
  );

  // The main sample is never offered as its own companion, and a zero slot
  // request still reports the eligible pool for the UI.
  const noSlots = recommendSamplePlanCompanions({
    main: recommendationMain,
    candidates: [recommendationMain, ...recommendationCandidates],
    limit: 0,
  });
  assert.deepEqual(noSlots.candidates, []);
  assert.equal(noSlots.eligibleCount, 4);
  assert.equal(noSlots.requestedCount, 0);

  // Mixed base units hide the summed quantity unit instead of inventing one.
  const mixedUnit = recommendSamplePlanCompanions({
    main: recommendationMain,
    limit: 1,
    candidates: [sample("REC-MIX", [
      flower("rec-rose", { quantity: 5, availableQty: 0 }),
      { ...flower("rec-ribbon", { quantity: 1, availableQty: 0, scale: 1 }), baseUnit: "卷" },
    ])],
  });
  assert.equal(mixedUnit.candidates[0]!.baseUnit, null);
  assert.equal(mixedUnit.candidates[0]!.reuseRate, 0.8333);

  assert.throws(
    () => recommendSamplePlanCompanions({
      main: sample("REC-EMPTY", []),
      candidates: recommendationCandidates,
      limit: 1,
    }),
    /还没有花材搭配/,
  );
  assert.throws(
    () => recommendSamplePlanCompanions({
      main: recommendationMain,
      candidates: recommendationCandidates,
      limit: -1,
    }),
    /非负整数/,
  );

  assert.equal(sampleMaterialCost([{ quantity: 2, unitCost: 2.5 }, { quantity: 1, unitCost: 4 }]), 9);

  console.log("v2 sample-planning domain tests passed");
}

main();
