/**
 * Run with:
 *   npx tsx src/services/loss-model-pure.test.ts
 */
import assert from "node:assert/strict";
import { LossMode } from "@/generated/prisma/enums";
import {
  buildDefaultLossProfile,
  calculateLossAdjustedLineCost,
  calculateLossAdjustedUnitCost,
  getLossRateFromUsableRate,
  getUsableRateByMode,
  normalizeUsableRate,
} from "@/services/loss-model-pure";

function testNormalizeUsableRate085() {
  const result = normalizeUsableRate(0.85);
  assert.equal(result.usableRate.toNumber(), 0.85);
  assert.deepEqual(result.warnings, []);
}

function testNormalizeUsableRate85Percent() {
  const result = normalizeUsableRate(85);
  assert.equal(result.usableRate.toNumber(), 0.85);
}

function testNormalizeUsableRateNull() {
  const result = normalizeUsableRate(null, { defaultRate: 0.85 });
  assert.equal(result.usableRate.toNumber(), 0.85);
}

function testNormalizeUsableRateZero() {
  const result = normalizeUsableRate(0, { defaultRate: 0.85 });
  assert.ok(result.warnings.length > 0);
  assert.equal(result.usableRate.toNumber(), 0.85);
}

function testNormalizeUsableRateOver100() {
  const result = normalizeUsableRate(150, { defaultRate: 0.85 });
  assert.ok(result.warnings.length > 0);
  assert.equal(result.usableRate.toNumber(), 0.85);
}

function testLossAdjustedUnitCost() {
  const result = calculateLossAdjustedUnitCost(2, 0.85);
  assert.equal(result.lossAdjustedUnitCost.toFixed(4), "2.3529");
}

function testGetLossRateFromUsableRate() {
  const lossRate = getLossRateFromUsableRate(0.85);
  assert.equal(lossRate.toFixed(4), "0.1500");
}

function testCalculateLossAdjustedLineCost() {
  const result = calculateLossAdjustedLineCost({
    actualTotalCost: 80,
    actualUnitCost: 2,
    totalStems: 40,
    usableRate: 0.85,
  });
  assert.equal(result.lossAdjustedUnitCost.toFixed(4), "2.3529");
  assert.equal(result.lossAdjustedTotalCost.toFixed(2), "94.12");
  assert.equal(result.lossModelExtraCost.toFixed(2), "14.12");
}

function testGetUsableRateByModeFallbacks() {
  const defaults = buildDefaultLossProfile();
  assert.equal(
    getUsableRateByMode(null, LossMode.OPTIMISTIC).toNumber(),
    defaults.optimisticUsableRate
  );
  assert.equal(
    getUsableRateByMode(null, LossMode.STANDARD).toNumber(),
    defaults.standardUsableRate
  );
  assert.equal(
    getUsableRateByMode(null, LossMode.CONSERVATIVE).toNumber(),
    defaults.conservativeUsableRate
  );

  const wiki = {
    optimisticUsableRate: 0.9,
    standardUsableRate: 0.8,
    conservativeUsableRate: 0.7,
    defaultUsableRate: 0.8,
  };
  assert.equal(
    getUsableRateByMode(wiki, LossMode.OPTIMISTIC).toNumber(),
    0.9
  );
  assert.equal(
    getUsableRateByMode(wiki, LossMode.STANDARD).toNumber(),
    0.8
  );
  assert.equal(
    getUsableRateByMode(wiki, LossMode.CONSERVATIVE).toNumber(),
    0.7
  );
}

function run() {
  testNormalizeUsableRate085();
  testNormalizeUsableRate85Percent();
  testNormalizeUsableRateNull();
  testNormalizeUsableRateZero();
  testNormalizeUsableRateOver100();
  testLossAdjustedUnitCost();
  testGetLossRateFromUsableRate();
  testCalculateLossAdjustedLineCost();
  testGetUsableRateByModeFallbacks();
  console.log("loss-model-pure tests passed");
}

run();
