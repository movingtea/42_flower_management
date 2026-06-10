/**
 * 运行：npm run test:data-quality
 */
import assert from "node:assert/strict";
import {
  buildDataQualityResult,
  createDataQualityIssue,
  filterDataQualityIssues,
  issueFlowerWikiMissingCost,
  issueHomeSceneEntryInvalid,
  issueLocalhostImage,
  issueOrderMissingCostSnapshot,
  issueProductMissingImage,
  issueRecipeWithoutLines,
  issueRecommendationInactiveProduct,
  issueSkuMissingRecipe,
  summarizeDataQualityIssues,
} from "@/services/data-quality-pure";

function testFlowerWikiMissingCost() {
  const issue = issueFlowerWikiMissingCost("w1", "玫瑰");
  assert.equal(issue.severity, "WARNING");
  assert.equal(issue.domain, "WMS");
}

function testRecipeNoLines() {
  const issue = issueRecipeWithoutLines("r1", "经典花束");
  assert.equal(issue.severity, "CRITICAL");
}

function testSkuNoRecipe() {
  const issue = issueSkuMissingRecipe("s1", "标准款");
  assert.equal(issue.entityType, "ProductSku");
}

function testProductMissingImage() {
  const issue = issueProductMissingImage("p1", "测试花束");
  assert.equal(issue.severity, "WARNING");
}

function testRecommendationInactive() {
  const issue = issueRecommendationInactiveProduct("i1", "下架商品");
  assert.equal(issue.severity, "CRITICAL");
}

function testHomeSceneInvalid() {
  const issue = issueHomeSceneEntryInvalid("e1", "生日", "缺少 sceneType");
  assert.match(issue.message, /生日/);
}

function testOrderMissingSnapshot() {
  const issue = issueOrderMissingCostSnapshot("o1", "ORD001");
  assert.equal(issue.domain, "ORDER");
}

function testLocalhostImage() {
  const issue = issueLocalhostImage("ProductSku", "s1", "imageUrl");
  assert.equal(issue.severity, "CRITICAL");
}

function testSummarizeAndFilter() {
  const issues = [
    createDataQualityIssue({
      severity: "CRITICAL",
      domain: "WMS",
      entityType: "Batch",
      entityId: "b1",
      title: "t1",
      message: "m1",
    }),
    createDataQualityIssue({
      severity: "WARNING",
      domain: "CMS",
      entityType: "ProductSpu",
      entityId: "p1",
      title: "t2",
      message: "m2",
    }),
  ];
  const summary = summarizeDataQualityIssues(issues);
  assert.equal(summary.criticalCount, 1);
  assert.equal(summary.warningCount, 1);

  const filtered = filterDataQualityIssues(issues, {
    severity: "CRITICAL",
    page: 1,
    pageSize: 10,
  });
  assert.equal(filtered.issues.length, 1);
  assert.equal(buildDataQualityResult(issues).issues.length, 2);
}

function run() {
  testFlowerWikiMissingCost();
  testRecipeNoLines();
  testSkuNoRecipe();
  testProductMissingImage();
  testRecommendationInactive();
  testHomeSceneInvalid();
  testOrderMissingSnapshot();
  testLocalhostImage();
  testSummarizeAndFilter();
  console.log("data-quality-pure.test.ts: all passed");
}

run();
