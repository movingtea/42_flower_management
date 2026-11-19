import assert from "node:assert/strict";
import {
  DEFAULT_LOW_MARGIN_THRESHOLD,
  buildReportHref,
  buildReportQuery,
  parseReportFilters,
  parseReportThreshold,
} from "./report-params";

function testParse() {
  assert.deepEqual(parseReportFilters({}), {
    tab: "overview",
    preset: "thisMonth",
    startDate: undefined,
    endDate: undefined,
    threshold: DEFAULT_LOW_MARGIN_THRESHOLD,
  });
  assert.deepEqual(parseReportFilters({ tab: "products", preset: "today" }), {
    tab: "products",
    preset: "today",
    startDate: undefined,
    endDate: undefined,
    threshold: DEFAULT_LOW_MARGIN_THRESHOLD,
  });
  assert.equal(parseReportFilters({ tab: "unknown" }).tab, "overview");
  assert.equal(parseReportFilters({ preset: "nope" }).preset, "thisMonth");
  assert.equal(parseReportFilters({ startDate: "2026-11-01", endDate: "bad" }).startDate, "2026-11-01");
  assert.equal(parseReportFilters({ startDate: "2026-13-01" }).startDate, undefined);
  assert.equal(parseReportFilters({ threshold: "0.2" }).threshold, 0.2);
  assert.equal(parseReportFilters({ threshold: "2" }).threshold, 1);
  assert.equal(parseReportFilters({ threshold: "-1" }).threshold, 0);
  assert.equal(parseReportThreshold("abc"), DEFAULT_LOW_MARGIN_THRESHOLD);
}

function testBuildHref() {
  const base = parseReportFilters({ tab: "sales", preset: "lastMonth" });
  assert.equal(buildReportHref(base), "/v2/reports?tab=sales&preset=lastMonth");
  assert.equal(
    buildReportHref(base, { tab: "inventory", startDate: "2026-11-01", endDate: "2026-11-05" }),
    "/v2/reports?tab=inventory&startDate=2026-11-01&endDate=2026-11-05",
  );
  // Custom dates replace the preset in the URL.
  const overview = parseReportFilters({});
  assert.equal(buildReportHref(overview), "/v2/reports");
  assert.equal(buildReportHref(overview, { threshold: 0.2 }), "/v2/reports?threshold=0.2");
  assert.equal(buildReportQuery(overview), "");
}

function run() {
  testParse();
  testBuildHref();
  console.log("v2 report params tests passed");
}

run();
