import assert from "node:assert/strict";
import {
  createDataQualityIssue,
  filterDataQualityIssues,
  isDataQualityDomain,
  isDataQualitySeverity,
  issueBrokenReference,
  issueCrossTenantReference,
  issueDeliveredWithoutSnapshot,
  issueIllegalQuantity,
  issueMissingRecipe,
  issueMissingTenantStore,
  sortDataQualityIssues,
  summarizeDataQualityIssues,
  type DataQualityCheckResult,
  type DataQualityIssue,
} from "./data-quality";

function issue(
  severity: DataQualityIssue["severity"],
  domain: DataQualityIssue["domain"],
  entityId: string,
): DataQualityIssue {
  return createDataQualityIssue({
    severity,
    domain,
    entityType: "Test",
    entityId,
    title: `issue-${entityId}`,
    message: "message",
  });
}

function testFactories() {
  const missingRecipe = issueMissingRecipe("sku-1", "红玫瑰花束", "11 支");
  assert.equal(missingRecipe.severity, "CRITICAL");
  assert.equal(missingRecipe.domain, "RECIPE");
  assert.match(missingRecipe.message, /没有已发布配方/);
  assert.match(missingRecipe.id, /^RECIPE:ProductSku:sku-1:/);

  const delivered = issueDeliveredWithoutSnapshot("order 1", "ORD-1");
  assert.equal(delivered.actionHref, "/v2/orders?orderId=order%201");

  const tenant = issueMissingTenantStore("Store", "store-1", "门店没有库位");
  assert.equal(tenant.domain, "TENANCY");
  assert.equal(tenant.severity, "CRITICAL");

  const illegal = issueIllegalQuantity("INVENTORY", "BatchBalance", "balance-1", "实存为负");
  assert.equal(illegal.title, "非法数量");
  assert.equal(illegal.severity, "CRITICAL");

  // A broken sibling reference keeps its own title and links to the order page;
  // the cross-tenant factory stays reserved for tenant/store ownership mismatches.
  const broken = issueBrokenReference(
    "INVENTORY",
    "InventoryReservation",
    "reservation-1",
    "批次物料与订单需求物料不一致",
  );
  assert.equal(broken.title, "关键引用异常");
  assert.equal(broken.domain, "INVENTORY");
  assert.equal(broken.actionHref, "/v2/orders");
  assert.match(broken.id, /^INVENTORY:InventoryReservation:reservation-1:/);

  const crossTenant = issueCrossTenantReference("Order", "order-1", "门店归属不一致");
  assert.equal(crossTenant.title, "关键引用跨租户或跨门店");
}

function testSummaryAndFiltering() {
  const checks: DataQualityCheckResult[] = [
    { key: "a", domain: "INVENTORY", title: "a", issueCount: 2 },
    { key: "b", domain: "ORDER", title: "b", issueCount: 0 },
  ];
  const issues = [
    issue("SUGGESTION", "MASTER_DATA", "3"),
    issue("CRITICAL", "INVENTORY", "1"),
    issue("WARNING", "ORDER", "2"),
    issue("CRITICAL", "INVENTORY", "4"),
  ];
  const summary = summarizeDataQualityIssues(issues, checks);
  assert.deepEqual(summary, {
    criticalCount: 2,
    warningCount: 1,
    suggestionCount: 1,
    totalCount: 4,
    passedCheckCount: 1,
  });
  assert.deepEqual(
    sortDataQualityIssues(issues).map((item) => item.entityId),
    ["1", "4", "2", "3"],
  );

  const page = filterDataQualityIssues(issues, { page: 1, pageSize: 2 });
  assert.equal(page.issues.length, 2);
  assert.deepEqual(page.pagination, { page: 1, pageSize: 2, total: 4, totalPages: 2 });

  const critical = filterDataQualityIssues(issues, { severity: "CRITICAL" });
  assert.equal(critical.pagination.total, 2);

  const inventory = filterDataQualityIssues(issues, { domain: "INVENTORY" });
  assert.equal(inventory.pagination.total, 2);

  const beyond = filterDataQualityIssues(issues, { page: 99 });
  // Out-of-range pages clamp to the last page instead of rendering an empty
  // list while issues exist.
  assert.equal(beyond.pagination.page, 1);
  assert.equal(beyond.issues.length, 4);

  const beyondLastPage = filterDataQualityIssues(issues, { page: 99, pageSize: 2 });
  assert.equal(beyondLastPage.pagination.page, 2);
  assert.equal(beyondLastPage.issues.length, 2);

  const firstPage = filterDataQualityIssues(issues, { page: 0, pageSize: 2 });
  assert.equal(firstPage.pagination.page, 1);
  assert.equal(firstPage.pagination.totalPages, 2);
}

function testGuardsAndIds() {
  assert.equal(isDataQualitySeverity("CRITICAL"), true);
  assert.equal(isDataQualitySeverity("critical"), false);
  assert.equal(isDataQualityDomain("INVENTORY"), true);
  assert.equal(isDataQualityDomain("CMS"), false);

  const first = createDataQualityIssue({
    severity: "WARNING",
    domain: "ORDER",
    entityType: "Order",
    entityId: null,
    title: "无归属订单",
    message: "message",
  });
  const second = createDataQualityIssue({
    severity: "WARNING",
    domain: "ORDER",
    entityType: "Order",
    entityId: null,
    title: "无归属订单",
    message: "different message",
  });
  assert.equal(first.id, second.id);

  const custom = createDataQualityIssue({
    id: "custom-id",
    severity: "WARNING",
    domain: "ORDER",
    entityType: "Order",
    entityId: null,
    title: "x",
    message: "y",
  });
  assert.equal(custom.id, "custom-id");
}

function run() {
  testFactories();
  testSummaryAndFiltering();
  testGuardsAndIds();
  console.log("v2 data quality domain tests passed");
}

run();
