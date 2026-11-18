import assert from "node:assert/strict";
import { buildAuditHref, parseAuditFilters } from "./audit-params";

function testParse() {
  assert.deepEqual(parseAuditFilters({}), {
    action: undefined,
    entityType: undefined,
    entityId: undefined,
    actorStaffId: undefined,
    startDate: undefined,
    endDate: undefined,
    page: 1,
  });
  const parsed = parseAuditFilters({
    action: "  PURCHASE_ORDER_SUBMITTED ",
    entityType: "PurchaseOrder",
    entityId: "abc",
    actor: "staff-1",
    startDate: "2026-11-01",
    endDate: "2026-11-06",
    page: "3",
  });
  assert.equal(parsed.action, "PURCHASE_ORDER_SUBMITTED");
  assert.equal(parsed.entityType, "PurchaseOrder");
  assert.equal(parsed.page, 3);
  assert.equal(parseAuditFilters({ page: "0" }).page, 1);
  assert.equal(parseAuditFilters({ page: "abc" }).page, 1);
  assert.equal(parseAuditFilters({ page: "1.5" }).page, 1);
  assert.equal(parseAuditFilters({ startDate: "2026-13-01" }).startDate, undefined);
}

function testInvalidFilterValues() {
  // Repeated query parameters (arrays) are ignored instead of crashing.
  assert.equal(parseAuditFilters({ action: ["A", "B"] }).action, undefined);
  assert.equal(parseAuditFilters({ page: ["1", "2"] }).page, 1);
  // Blank text is dropped rather than filtering on an empty string.
  assert.equal(parseAuditFilters({ entityId: "   " }).entityId, undefined);
  assert.equal(parseAuditFilters({ actor: "" }).actorStaffId, undefined);
  // Impossible calendar dates must not roll over into another month.
  assert.equal(parseAuditFilters({ startDate: "2026-02-31" }).startDate, undefined);
  assert.equal(parseAuditFilters({ endDate: "2026-04-31" }).endDate, undefined);
  assert.equal(parseAuditFilters({ startDate: "2026-00-10" }).startDate, undefined);
  assert.equal(parseAuditFilters({ startDate: "2026-11-00" }).startDate, undefined);
  assert.equal(parseAuditFilters({ endDate: "2023-02-29" }).endDate, undefined);
  assert.equal(parseAuditFilters({ startDate: "0000-01-01" }).startDate, undefined);
  // Real leap days remain valid.
  assert.equal(parseAuditFilters({ startDate: "2024-02-29" }).startDate, "2024-02-29");
  // Over-long values are capped, not used as-is.
  assert.equal(parseAuditFilters({ action: "A".repeat(200) }).action?.length, 120);
}

function testHref() {
  const filters = parseAuditFilters({
    action: "DELIVERY_COMPLETED",
    entityType: "Order",
    startDate: "2026-11-01",
    page: "2",
  });
  assert.equal(
    buildAuditHref(filters, 1),
    "/v2/audit?action=DELIVERY_COMPLETED&entityType=Order&startDate=2026-11-01",
  );
  assert.equal(
    buildAuditHref(filters),
    "/v2/audit?action=DELIVERY_COMPLETED&entityType=Order&startDate=2026-11-01&page=2",
  );
  assert.equal(buildAuditHref(parseAuditFilters({}), 1), "/v2/audit");

  // Every filter survives a build → parse → build round trip, including
  // non-ASCII entity ids (percent-encoded by URLSearchParams).
  const roundTripFilters = parseAuditFilters({
    action: "LOSS_RECORDED",
    entityId: "订单 001",
    actor: "staff-1",
    endDate: "2026-11-06",
    page: "3",
  });
  const href = buildAuditHref(roundTripFilters);
  assert.equal(
    href,
    "/v2/audit?action=LOSS_RECORDED&entityId=%E8%AE%A2%E5%8D%95+001&actor=staff-1&endDate=2026-11-06&page=3",
  );
  const search = new URLSearchParams(href.slice(href.indexOf("?") + 1));
  assert.deepEqual(parseAuditFilters(Object.fromEntries(search)), roundTripFilters);

  assert.equal(buildAuditHref(parseAuditFilters({}), 5), "/v2/audit?page=5");
}

function run() {
  testParse();
  testInvalidFilterValues();
  testHref();
  console.log("v2 audit params tests passed");
}

run();
