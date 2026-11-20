import assert from "node:assert/strict";
import {
  SAMPLE_PLAN_ALGORITHM_VERSION,
  calculateSamplePlan,
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

  // Two mandatory samples: the first is disassembled, its reusable share feeds
  // the second, and only the remaining requirement is bought.
  const pair = calculateSamplePlan({
    samples: [
      sample("A", [flower("rose", { quantity: 10, availableQty: 12, reusableRate: 0.5 })]),
      sample("B", [flower("rose", { quantity: 6, availableQty: 12, reusableRate: 0.5 })]),
    ],
    selections: [
      { sampleId: "A", quantity: 1, mandatory: true, sequenceNo: 1 },
      { sampleId: "B", quantity: 1, mandatory: true, sequenceNo: 2 },
    ],
  });
  assert.equal(pair.runs.length, 1);
  const pairRun = pair.runs[0]!;
  assert.equal(pairRun.steps.length, 2);
  assert.equal(pairRun.steps[0]!.materials[0]!.reusableAfterDisassemblyQty, 5);
  assert.equal(pairRun.steps[0]!.materials[0]!.lossQty, 5);
  assert.equal(pairRun.steps[1]!.materials[0]!.reusedQty, 5);
  assert.equal(pairRun.steps[1]!.materials[0]!.stockQty, 1);
  assert.equal(pairRun.steps[1]!.materials[0]!.purchaseQty, 0);
  assert.equal(pairRun.totalCost, 22);
  assert.equal(pairRun.independentCost, 32);
  assert.equal(pairRun.estimatedSaving, 10);
  assert.equal(pairRun.reuseRate, 0.3125);

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

  // Multiple mandatory samples disable optional suggestions.
  const noSuggestion = calculateSamplePlan({
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
  assert.equal(noSuggestion.runs.length, 1);
  assert.match(noSuggestion.warnings.join(" "), /不再自动追加建议样品/);

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
  assert.deepEqual(partialTwo.candidateSnapshot.suggestedSampleIds, ["E", "B"]);
  assert.equal(partialTwo.candidateSnapshot.suggestedSampleReasons[1]!.exactClass, 0);
  assert.equal(partialTwo.candidateSnapshot.suggestedSampleReasons[1]!.varietyColor, 0);
  assert.deepEqual(
    partialTwo.candidateSnapshot.suggestedSampleReasons[1]!.matchedClassifications,
    [],
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

  // Multiple mandatory samples still disable optional suggestions even when a
  // candidate matches the required flower classification.
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
  assert.equal(classifiedPair.runs.length, 1);
  assert.deepEqual(classifiedPair.runs[0]!.candidateSnapshot.suggestedSampleIds, []);
  assert.match(classifiedPair.warnings.join(" "), /不再自动追加建议样品/);

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

  assert.equal(sampleMaterialCost([{ quantity: 2, unitCost: 2.5 }, { quantity: 1, unitCost: 4 }]), 9);

  console.log("v2 sample-planning domain tests passed");
}

main();
