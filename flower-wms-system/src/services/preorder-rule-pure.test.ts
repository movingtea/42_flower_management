/**
 * 纯函数单测（无数据库）— 运行：npm run test:preorder-rule
 */
import assert from "node:assert/strict";
import {
  computeEarliestDeliveryDate,
  evaluateBulkPreorderRequirement,
  formatBulkPreorderServerMessage,
  formatDefaultBulkPreorderHint,
  isPreorderRuleConfigValid,
  resolveSkuPreorderRule,
} from "./preorder-rule-pure";

const SHANGHAI_NOON_UTC = new Date("2026-06-10T04:00:00.000Z");

function testSkuDisabledAllows() {
  const result = evaluateBulkPreorderRequirement({
    items: [
      {
        skuId: "sku-1",
        productName: "玫瑰礼盒",
        skuName: "标准款",
        quantity: 10,
        preorderRule: resolveSkuPreorderRule({
          skuRule: { bulkPreorderEnabled: false },
        }),
      },
    ],
    deliveryDate: "2026-06-10 上午",
    now: SHANGHAI_NOON_UTC,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.violations.length, 0);
}

function testBelowThresholdAllows() {
  const rule = resolveSkuPreorderRule({
    skuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 3,
      bulkMinLeadDays: 1,
    },
  });
  const result = evaluateBulkPreorderRequirement({
    items: [
      {
        skuId: "sku-1",
        productName: "玫瑰礼盒",
        skuName: "标准款",
        quantity: 2,
        preorderRule: rule,
      },
    ],
    deliveryDate: "2026-06-10 上午",
    now: SHANGHAI_NOON_UTC,
  });
  assert.equal(result.allowed, true);
}

function testSameDayViolation() {
  const rule = resolveSkuPreorderRule({
    skuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 3,
      bulkMinLeadDays: 1,
    },
  });
  const result = evaluateBulkPreorderRequirement({
    items: [
      {
        skuId: "sku-1",
        productName: "玫瑰礼盒",
        skuName: "标准款",
        quantity: 3,
        preorderRule: rule,
      },
    ],
    deliveryDate: "2026-06-10",
    now: SHANGHAI_NOON_UTC,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].earliestDeliveryDate, "2026-06-11");
}

function testTomorrowAllowed() {
  const rule = resolveSkuPreorderRule({
    skuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 3,
      bulkMinLeadDays: 1,
    },
  });
  const result = evaluateBulkPreorderRequirement({
    items: [
      {
        skuId: "sku-1",
        productName: "玫瑰礼盒",
        skuName: "标准款",
        quantity: 3,
        preorderRule: rule,
      },
    ],
    deliveryDate: "2026-06-11 下午",
    now: SHANGHAI_NOON_UTC,
  });
  assert.equal(result.allowed, true);
}

function testMultiSkuTakesMaxEarliestDate() {
  const ruleA = resolveSkuPreorderRule({
    skuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 2,
      bulkMinLeadDays: 1,
    },
  });
  const ruleB = resolveSkuPreorderRule({
    skuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 2,
      bulkMinLeadDays: 3,
    },
  });
  const result = evaluateBulkPreorderRequirement({
    items: [
      {
        skuId: "sku-a",
        productName: "商品A",
        skuName: "款A",
        quantity: 2,
        preorderRule: ruleA,
      },
      {
        skuId: "sku-b",
        productName: "商品B",
        skuName: "款B",
        quantity: 2,
        preorderRule: ruleB,
      },
    ],
    deliveryDate: "2026-06-12",
    now: SHANGHAI_NOON_UTC,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.earliestDeliveryDate, "2026-06-13");
}

function testDeliveryBeforeEarliestViolation() {
  const rule = resolveSkuPreorderRule({
    skuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 2,
      bulkMinLeadDays: 2,
    },
  });
  const result = evaluateBulkPreorderRequirement({
    items: [
      {
        skuId: "sku-1",
        productName: "玫瑰礼盒",
        skuName: "标准款",
        quantity: 2,
        preorderRule: rule,
      },
    ],
    deliveryDate: "2026-06-11",
    now: SHANGHAI_NOON_UTC,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.violations[0].earliestDeliveryDate, "2026-06-12");
}

function testCustomMessagePreferred() {
  const rule = resolveSkuPreorderRule({
    skuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 3,
      bulkMinLeadDays: 1,
      bulkPreorderMessage: "请至少提前 {minLeadDays} 天预订这款花礼",
    },
  });
  const result = evaluateBulkPreorderRequirement({
    items: [
      {
        skuId: "sku-1",
        productName: "玫瑰礼盒",
        skuName: "标准款",
        quantity: 3,
        preorderRule: rule,
      },
    ],
    deliveryDate: "2026-06-10",
    now: SHANGHAI_NOON_UTC,
  });
  assert.match(result.violations[0].message, /请至少提前 1 天预订/);
}

function testInvalidThresholdDisablesRule() {
  const rule = resolveSkuPreorderRule({
    skuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 0,
      bulkMinLeadDays: 1,
    },
  });
  assert.equal(rule.enabled, false);
  assert.equal(isPreorderRuleConfigValid({ bulkPreorderEnabled: true, bulkOrderThreshold: 0, bulkMinLeadDays: 1 }), false);
}

function testShanghaiDateCalculation() {
  const earliest = computeEarliestDeliveryDate(1, SHANGHAI_NOON_UTC);
  assert.equal(earliest, "2026-06-11");
}

function testDefaultHintFormat() {
  assert.equal(
    formatDefaultBulkPreorderHint(3, 1),
    "购买 3 件及以上需提前 1 天预订。"
  );
}

function testServerMessageFormat() {
  assert.equal(
    formatBulkPreorderServerMessage("2026-06-11"),
    "当前订单数量较多，需要提前预订，最早可选择 2026-06-11 配送。"
  );
}

function testOrderCreateWouldRejectBeforeStockDecrement() {
  const rule = resolveSkuPreorderRule({
    skuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 3,
      bulkMinLeadDays: 1,
    },
  });
  const blocked = evaluateBulkPreorderRequirement({
    items: [
      {
        skuId: "sku-1",
        productName: "测试花礼",
        skuName: "标准款",
        quantity: 3,
        preorderRule: rule,
      },
    ],
    deliveryDate: "2026-06-10 上午",
    now: SHANGHAI_NOON_UTC,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.violations.length, 1);

  const allowed = evaluateBulkPreorderRequirement({
    items: [
      {
        skuId: "sku-1",
        productName: "测试花礼",
        skuName: "标准款",
        quantity: 3,
        preorderRule: rule,
      },
    ],
    deliveryDate: "2026-06-11 下午",
    now: SHANGHAI_NOON_UTC,
  });
  assert.equal(allowed.allowed, true);
}

function testSkuPriorityOverSpu() {
  const rule = resolveSkuPreorderRule({
    skuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 3,
      bulkMinLeadDays: 1,
    },
    spuRule: {
      bulkPreorderEnabled: true,
      bulkOrderThreshold: 10,
      bulkMinLeadDays: 5,
    },
  });
  assert.equal(rule.source, "SKU");
  assert.equal(rule.threshold, 3);
}

function run() {
  testSkuDisabledAllows();
  testBelowThresholdAllows();
  testSameDayViolation();
  testTomorrowAllowed();
  testMultiSkuTakesMaxEarliestDate();
  testDeliveryBeforeEarliestViolation();
  testCustomMessagePreferred();
  testInvalidThresholdDisablesRule();
  testShanghaiDateCalculation();
  testDefaultHintFormat();
  testServerMessageFormat();
  testOrderCreateWouldRejectBeforeStockDecrement();
  testSkuPriorityOverSpu();
  console.log("preorder-rule-pure.test.ts: all tests passed");
}

run();
