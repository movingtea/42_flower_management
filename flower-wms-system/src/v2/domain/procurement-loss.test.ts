import assert from "node:assert/strict";
import {
  PROCUREMENT_LOSS_MAX_RATE,
  applyProcurementLoss,
  normalizeProcurementLossRate,
  resolveProcurementLossRate,
  summarizeProcurementChannels,
} from "./procurement-loss";

function main(): void {
  assert.equal(normalizeProcurementLossRate(null), null);
  assert.equal(normalizeProcurementLossRate(undefined), null);
  assert.equal(normalizeProcurementLossRate(0.125), 0.125);
  assert.throws(() => normalizeProcurementLossRate(-0.01), /渠道损耗率/);
  assert.throws(() => normalizeProcurementLossRate(PROCUREMENT_LOSS_MAX_RATE + 0.01), /渠道损耗率/);
  assert.throws(() => normalizeProcurementLossRate(0.12345), /四位小数/);

  // Supplier channel rate wins over the material fallback; unknown falls to 0.
  assert.equal(resolveProcurementLossRate({ supplierRate: 0.2, materialRate: 0.1 }), 0.2);
  assert.equal(resolveProcurementLossRate({ supplierRate: null, materialRate: 0.1 }), 0.1);
  assert.equal(resolveProcurementLossRate({}), 0);

  const loss = applyProcurementLoss({ quantity: 100, unitCost: 2, lossRate: 0.2 });
  assert.equal(loss.usableQty, 80);
  assert.equal(loss.expectedLossQty, 20);
  assert.equal(loss.lossAdjustedUnitCost, 2.5);
  assert.equal(loss.quantity, 100);
  assert.equal(loss.unitCost, 2);

  // Loss-adjusted cost = physical cost / usable quantity. Physical amount is
  // unchanged; the expected usable amount equals the original amount.
  assert.equal(
    Math.round(loss.usableQty * loss.lossAdjustedUnitCost * 100) / 100,
    loss.quantity * loss.unitCost,
  );

  const zero = applyProcurementLoss({ quantity: 8, unitCost: 3, lossRate: 0 });
  assert.equal(zero.usableQty, 8);
  assert.equal(zero.expectedLossQty, 0);
  assert.equal(zero.lossAdjustedUnitCost, 3);

  const heavy = applyProcurementLoss({ quantity: 3, unitCost: 5, lossRate: 0.99 });
  assert.equal(heavy.usableQty, 0.03);
  assert.equal(heavy.expectedLossQty, 2.97);

  assert.throws(() => applyProcurementLoss({ quantity: -1, unitCost: 1, lossRate: 0 }), /采购数量/);
  assert.throws(() => applyProcurementLoss({ quantity: 1, unitCost: -1, lossRate: 0 }), /采购单价/);

  const summary = summarizeProcurementChannels([
    { quantity: 10, unitCost: 2, lossRate: 0.2 },
    { quantity: 10, unitCost: 2, lossRate: 0.2 },
    { quantity: 10, unitCost: 2, lossRate: 0 },
  ]);
  assert.equal(summary.length, 2);
  assert.deepEqual(summary[0], {
    lossRate: 0,
    quantity: 10,
    usableQty: 10,
    expectedLossQty: 0,
    amount: 20,
    lossAdjustedAmount: 20,
  });
  assert.deepEqual(summary[1], {
    lossRate: 0.2,
    quantity: 20,
    usableQty: 16,
    expectedLossQty: 4,
    amount: 40,
    lossAdjustedAmount: 40,
  });

  console.log("v2 procurement channel loss domain tests passed");
}

main();
