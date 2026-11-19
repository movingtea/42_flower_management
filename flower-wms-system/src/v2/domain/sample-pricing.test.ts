import assert from "node:assert/strict";
import {
  calculateSamplePricing,
  conversionRate,
  costVariance,
  reuseRate,
} from "./sample-pricing";

function main(): void {
  const pricing = calculateSamplePricing({
    materialCost: 60,
    packagingCost: 10,
    laborCost: 30,
    targetMarginRate: 0.6,
  });
  assert.equal(pricing.totalCost, 100);
  assert.equal(pricing.suggestedPrice, 250);
  assert.equal(pricing.marginAtTargetPrice, null);

  const withPrice = calculateSamplePricing({
    materialCost: 100,
    targetMarginRate: 0.5,
    targetPrice: 250,
  });
  assert.equal(withPrice.suggestedPrice, 200);
  assert.equal(withPrice.marginAtTargetPrice, 0.6);

  const noMargin = calculateSamplePricing({ materialCost: 10 });
  assert.equal(noMargin.suggestedPrice, null);
  assert.equal(noMargin.targetMarginRate, null);

  assert.throws(
    () => calculateSamplePricing({ materialCost: 10, targetMarginRate: 1 }),
    /小于 1/,
  );
  assert.throws(
    () => calculateSamplePricing({ materialCost: -1 }),
    /非负/,
  );

  const variance = costVariance(100, 115);
  assert.deepEqual(variance, {
    plannedCost: 100,
    actualCost: 115,
    variance: 15,
    varianceRate: 0.15,
    overBudget: true,
  });
  assert.equal(costVariance(100, 90).overBudget, false);
  assert.equal(costVariance(0, 10).varianceRate, null);

  assert.equal(conversionRate(2, 4), 0.5);
  assert.equal(conversionRate(1, 0), 0);
  assert.throws(() => conversionRate(-1, 4), /非负整数/);

  assert.equal(reuseRate(25, 100), 0.25);
  assert.equal(reuseRate(25, 0), 0);

  console.log("v2 sample-pricing domain tests passed");
}

main();
