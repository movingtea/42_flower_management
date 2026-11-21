import assert from "node:assert/strict";
import {
  SAMPLE_SUBSTITUTION_TIER_LABELS,
  proposeSampleSubstitutions,
  sampleSubstitutionTier,
} from "./sample-substitution";

function main(): void {
  assert.equal(
    sampleSubstitutionTier(
      { flowerVariety: "玫瑰", flowerProductName: "玛格丽特", color: "红" },
      { flowerVariety: "玫瑰", flowerProductName: "玛格丽特", color: "红" },
    ),
    "exact",
  );
  assert.equal(
    sampleSubstitutionTier(
      { flowerVariety: "玫瑰", flowerProductName: "玛格丽特", color: "红" },
      { flowerVariety: "玫瑰", flowerProductName: "雪山", color: "红" },
    ),
    "varietyColor",
  );
  assert.equal(
    sampleSubstitutionTier(
      { flowerVariety: "玫瑰", flowerProductName: "玛格丽特", color: "红" },
      { flowerVariety: "玫瑰", flowerProductName: null, color: "白" },
    ),
    "variety",
  );
  assert.equal(
    sampleSubstitutionTier(
      { flowerVariety: "玫瑰", flowerProductName: "玛格丽特", color: "红" },
      { flowerVariety: "郁金香", flowerProductName: "玛格丽特", color: "红" },
    ),
    null,
  );
  assert.equal(SAMPLE_SUBSTITUTION_TIER_LABELS.exact, "三级全同");

  const proposals = proposeSampleSubstitutions({
    requirements: [{
      materialId: "rose-red",
      name: "高原红",
      quantity: 10,
      availableQty: 4,
      kind: "FLOWER",
      baseUnit: "支",
      flowerVariety: "玫瑰",
      flowerProductName: "高原红",
      color: "红",
    }],
    candidates: [
      {
        materialId: "rose-red-other",
        code: "M-002",
        name: "其他红玫瑰",
        kind: "FLOWER",
        baseUnit: "支",
        flowerVariety: "玫瑰",
        flowerProductName: "其他",
        color: "红",
        availableQty: 12,
        unitCost: 2,
      },
      {
        materialId: "rose-red-exact",
        code: "M-001",
        name: "高原红替代",
        kind: "FLOWER",
        baseUnit: "支",
        flowerVariety: "玫瑰",
        flowerProductName: "高原红",
        color: "红",
        availableQty: 8,
        unitCost: 2.5,
      },
      {
        materialId: "rose-white",
        code: "M-003",
        name: "白玫瑰",
        kind: "FLOWER",
        baseUnit: "支",
        flowerVariety: "玫瑰",
        flowerProductName: "雪山",
        color: "白",
        availableQty: 20,
        unitCost: 1.5,
      },
      {
        materialId: "tulip",
        code: "M-004",
        name: "郁金香",
        kind: "FLOWER",
        baseUnit: "支",
        flowerVariety: "郁金香",
        flowerProductName: "黄",
        color: "黄",
        availableQty: 20,
        unitCost: 1,
      },
      {
        materialId: "ribbon",
        code: "M-005",
        name: "丝带",
        kind: "PACKAGING",
        baseUnit: "卷",
        flowerVariety: "玫瑰",
        flowerProductName: "高原红",
        color: "红",
        availableQty: 20,
        unitCost: 1,
      },
    ],
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]!.fromMaterialId, "rose-red");
  assert.deepEqual(
    proposals[0]!.options.map((option) => [option.materialId, option.tier]),
    [["rose-red-exact", "exact"], ["rose-red-other", "varietyColor"], ["rose-white", "variety"]],
  );

  // Enough stock means no proposal; no candidate means an explicit empty list.
  const sufficient = proposeSampleSubstitutions({
    requirements: [{
      materialId: "rose-red",
      name: "高原红",
      quantity: 2,
      availableQty: 2,
      kind: "FLOWER",
      baseUnit: "支",
      flowerVariety: "玫瑰",
      flowerProductName: "高原红",
      color: "红",
    }],
    candidates: [],
  });
  assert.deepEqual(sufficient, []);

  console.log("v2 sample substitution domain tests passed");
}

main();
