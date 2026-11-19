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
