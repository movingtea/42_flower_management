/**
 * 运行：npx tsx src/lib/datetime.test.ts
 */
import assert from "node:assert/strict";
import {
  formatDateInAppTimezoneIso,
  formatDateTimeInAppTimezone,
  formatNullableDate,
  getAppDateRangeUtc,
  getAppDayRangeUtc,
} from "@/lib/datetime";
import { getReportDateRange } from "@/services/business-report-pure";

function testFormatUtcToShanghai() {
  assert.equal(
    formatDateTimeInAppTimezone("2026-06-09T16:00:00.000Z"),
    "2026-06-10 00:00"
  );
  assert.equal(
    formatDateTimeInAppTimezone("2026-06-10T15:59:59.000Z"),
    "2026-06-10 23:59"
  );
  assert.equal(formatNullableDate(null), "—");
}

function testGetAppDayRangeUtc() {
  const range = getAppDayRangeUtc("2026-06-10");
  assert.equal(range.startUtc.toISOString(), "2026-06-09T16:00:00.000Z");
  assert.equal(range.endUtcExclusive.toISOString(), "2026-06-10T16:00:00.000Z");
}

function testGetAppDateRangeUtcSameDay() {
  const range = getAppDateRangeUtc("2026-06-10", "2026-06-10");
  assert.equal(range.startUtc?.toISOString(), "2026-06-09T16:00:00.000Z");
  assert.equal(range.endUtcExclusive?.toISOString(), "2026-06-10T16:00:00.000Z");
}

function testReportDateRangeCustom() {
  const range = getReportDateRange({
    startDate: "2026-06-10",
    endDate: "2026-06-10",
    now: new Date("2026-06-10T08:00:00.000Z"),
  });
  assert.equal(range.startDate.toISOString(), "2026-06-09T16:00:00.000Z");
  assert.equal(range.endDate.toISOString(), "2026-06-10T16:00:00.000Z");
  assert.equal(range.label, "2026-06-10 至 2026-06-10");
}

function testReportDateRangeTodayInShanghai() {
  const range = getReportDateRange({
    preset: "today",
    now: new Date("2026-06-09T18:00:00.000Z"),
  });
  assert.equal(range.label, "今日");
  assert.equal(range.startDate.toISOString(), "2026-06-09T16:00:00.000Z");
  assert.equal(range.endDate.toISOString(), "2026-06-10T16:00:00.000Z");
  assert.equal(formatDateInAppTimezoneIso(range.startDate), "2026-06-10");
}

function run() {
  testFormatUtcToShanghai();
  testGetAppDayRangeUtc();
  testGetAppDateRangeUtcSameDay();
  testReportDateRangeCustom();
  testReportDateRangeTodayInShanghai();
  console.log("datetime tests passed");
}

run();
