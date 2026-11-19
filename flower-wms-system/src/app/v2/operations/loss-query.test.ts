/**
 * Run with:
 *   npx tsx src/app/v2/operations/loss-query.test.ts
 */
import assert from "node:assert/strict";
import {
  LOSS_PAGE_SIZE,
  buildLossHref,
  buildLossWhere,
  clampLossPage,
  lossPageNumbers,
  lossReviewStatusLabel,
  lossTotalPages,
  normalizeLossFilters,
  parsePage,
} from "./loss-query";

function testNormalizeLossFilters() {
  assert.deepEqual(normalizeLossFilters({}), {
    reason: undefined,
    reviewStatus: undefined,
    from: undefined,
    to: undefined,
  });

  assert.deepEqual(normalizeLossFilters({
    reason: "EXPIRED",
    reviewStatus: "APPROVED",
    from: "2026-06-10",
    to: "2026-06-11",
  }), {
    reason: "EXPIRED",
    reviewStatus: "APPROVED",
    from: "2026-06-10",
    to: "2026-06-11",
  });

  // Reason and status must be allowlisted.
  assert.equal(normalizeLossFilters({ reason: "BOGUS" }).reason, undefined);
  assert.equal(normalizeLossFilters({ reviewStatus: "ALL" }).reviewStatus, undefined);
  assert.equal(normalizeLossFilters({ reviewStatus: "PENDING_REVIEW" }).reviewStatus, undefined);

  // Invalid, impossible or repeated dates are ignored.
  assert.equal(normalizeLossFilters({ from: "2026-02-30" }).from, undefined);
  assert.equal(normalizeLossFilters({ from: "2026-02-29" }).from, undefined);
  assert.equal(normalizeLossFilters({ from: "2026-13-01" }).from, undefined);
  assert.equal(normalizeLossFilters({ from: "2026-99-01" }).from, undefined);
  assert.equal(normalizeLossFilters({ to: "06/10/2026" }).to, undefined);
  assert.equal(normalizeLossFilters({ to: ["2026-06-10"] }).to, undefined);
  assert.equal(normalizeLossFilters({ from: "2026-02-28" }).from, "2026-02-28");
  assert.equal(normalizeLossFilters({ to: "2026-12-31" }).to, "2026-12-31");

  assert.deepEqual(normalizeLossFilters({ reviewStatus: "PENDING" }), {
    reason: undefined,
    reviewStatus: "PENDING",
    from: undefined,
    to: undefined,
  });
}

function testParseAndPageCounts() {
  assert.equal(LOSS_PAGE_SIZE, 20);
  assert.equal(parsePage(undefined), 1);
  assert.equal(parsePage("3"), 3);
  assert.equal(parsePage(" 7 "), 7);
  assert.equal(parsePage("0"), 1);
  assert.equal(parsePage("-1"), 1);
  assert.equal(parsePage("abc"), 1);
  assert.equal(parsePage(["3"]), 1);

  assert.equal(lossTotalPages(0), 1);
  assert.equal(lossTotalPages(20), 1);
  assert.equal(lossTotalPages(21), 2);
  assert.equal(lossTotalPages(41), 3);
  assert.equal(clampLossPage(9, 41), 3);
  assert.equal(clampLossPage(2, 41), 2);
  assert.equal(clampLossPage(0, 41), 1);
}

function testBuildLossWhere() {
  assert.deepEqual(buildLossWhere("store-1", {}), { storeId: "store-1" });

  const where = buildLossWhere("store-1", {
    reason: "CARE_DAMAGE",
    reviewStatus: "PENDING",
    from: "2026-06-10",
    to: "2026-06-11",
  });
  assert.equal(where.storeId, "store-1");
  assert.equal(where.reason, "CARE_DAMAGE");
  assert.equal(where.reviewStatus, "PENDING");
  const occurredAt = where.occurredAt as { gte?: Date; lt?: Date };
  assert.equal(occurredAt.gte?.toISOString(), "2026-06-09T16:00:00.000Z");
  assert.equal(occurredAt.lt?.toISOString(), "2026-06-11T16:00:00.000Z");

  const fromOnly = buildLossWhere("store-1", { from: "2026-06-10" });
  assert.equal((fromOnly.occurredAt as { gte?: Date }).gte?.toISOString(), "2026-06-09T16:00:00.000Z");
  assert.equal((fromOnly.occurredAt as { lt?: Date }).lt, undefined);

  const toOnly = buildLossWhere("store-1", { to: "2026-06-10" });
  assert.equal((toOnly.occurredAt as { lt?: Date }).lt?.toISOString(), "2026-06-10T16:00:00.000Z");
  assert.equal((toOnly.occurredAt as { gte?: Date }).gte, undefined);
}

function testBuildLossHref() {
  const filters = {
    reason: "EXPIRED" as const,
    reviewStatus: "PENDING" as const,
    from: "2026-06-10",
    to: "2026-06-11",
  };
  assert.equal(
    buildLossHref(filters, 2),
    "/v2/operations?reason=EXPIRED&reviewStatus=PENDING&from=2026-06-10&to=2026-06-11&page=2#loss-history",
  );
  assert.equal(buildLossHref({}, 1), "/v2/operations#loss-history");
  assert.equal(buildLossHref({ reason: "EXPIRED" }, 1), "/v2/operations?reason=EXPIRED#loss-history");

  const withFeedback = buildLossHref(filters, 3, { message: "损耗已登记", error: undefined });
  const [path, hash] = withFeedback.split("#");
  assert.equal(hash, "loss-history");
  const params = new URLSearchParams(path.split("?")[1]);
  assert.equal(params.get("reason"), "EXPIRED");
  assert.equal(params.get("page"), "3");
  assert.equal(params.get("message"), "损耗已登记");
  assert.equal(params.get("error"), null);
}

function testLabelsAndPageWindow() {
  assert.equal(lossReviewStatusLabel(null), "未复核");
  assert.equal(lossReviewStatusLabel(undefined), "未复核");
  assert.equal(lossReviewStatusLabel("PENDING"), "待复核");
  assert.equal(lossReviewStatusLabel("APPROVED"), "已通过");
  assert.equal(lossReviewStatusLabel("REJECTED"), "已拒绝");
  assert.equal(lossReviewStatusLabel("OTHER"), "OTHER");

  assert.deepEqual(lossPageNumbers(1, 1), [1]);
  assert.deepEqual(lossPageNumbers(1, 10), [1, 2, 3]);
  assert.deepEqual(lossPageNumbers(5, 10), [3, 4, 5, 6, 7]);
  assert.deepEqual(lossPageNumbers(10, 10), [8, 9, 10]);
}

function run() {
  testNormalizeLossFilters();
  testParseAndPageCounts();
  testBuildLossWhere();
  testBuildLossHref();
  testLabelsAndPageWindow();
  console.log("operations loss query tests passed");
}

run();
