/**
 * Run: npm run test:banner-rules
 */
import assert from "node:assert/strict";
import { filterHomeBannersForMiniprogram } from "./banner-rules-pure";

const NOW = new Date("2026-06-10T10:00:00.000Z");

function testActiveBannerReturns() {
  const result = filterHomeBannersForMiniprogram([
    {
      id: "b1",
      imageUrl: "https://cdn.example.com/banner.jpg",
      sortOrder: 1,
      isActive: true,
      targetType: "NONE",
    },
  ], { now: NOW });
  assert.equal(result.length, 1);
  assert.equal(result[0].targetType, "NONE");
}

function testInactiveHidden() {
  const result = filterHomeBannersForMiniprogram([
    {
      id: "b1",
      imageUrl: "https://cdn.example.com/banner.jpg",
      sortOrder: 1,
      isActive: false,
      targetType: "NONE",
    },
  ], { now: NOW });
  assert.equal(result.length, 0);
}

function testSoftDeletedHidden() {
  const result = filterHomeBannersForMiniprogram([
    {
      id: "b1",
      imageUrl: "https://cdn.example.com/banner.jpg",
      sortOrder: 1,
      isActive: true,
      isDeleted: true,
      targetType: "NONE",
    },
  ], { now: NOW });
  assert.equal(result.length, 0);
}

function testStartsAtFutureHidden() {
  const result = filterHomeBannersForMiniprogram([
    {
      id: "b1",
      imageUrl: "https://cdn.example.com/banner.jpg",
      sortOrder: 1,
      isActive: true,
      startsAt: new Date("2026-06-11T00:00:00.000Z"),
      targetType: "NONE",
    },
  ], { now: NOW });
  assert.equal(result.length, 0);
}

function testEndsAtPastHidden() {
  const result = filterHomeBannersForMiniprogram([
    {
      id: "b1",
      imageUrl: "https://cdn.example.com/banner.jpg",
      sortOrder: 1,
      isActive: true,
      endsAt: new Date("2026-06-09T00:00:00.000Z"),
      targetType: "NONE",
    },
  ], { now: NOW });
  assert.equal(result.length, 0);
}

function testLocalhostNormalizedNotReturned() {
  const result = filterHomeBannersForMiniprogram([
    {
      id: "b1",
      imageUrl: "http://localhost:3000/uploads/banner.jpg",
      sortOrder: 1,
      isActive: true,
      targetType: "NONE",
    },
  ], { now: NOW });
  assert.equal(result.length, 1);
  assert.ok(!result[0].imageUrl.includes("localhost"));
  assert.ok(result[0].imageUrl.includes("/uploads/"));
}

function testNoJumpAllowed() {
  const result = filterHomeBannersForMiniprogram([
    {
      id: "b1",
      imageUrl: "/uploads/banner.jpg",
      sortOrder: 1,
      isActive: true,
      targetType: "NONE",
      targetParam: null,
    },
  ], { now: NOW });
  assert.equal(result.length, 1);
  assert.equal(result[0].targetType, "NONE");
}

function testStableSort() {
  const result = filterHomeBannersForMiniprogram([
    {
      id: "b2",
      imageUrl: "https://cdn.example.com/2.jpg",
      sortOrder: 2,
      createdAt: "2026-01-02",
      isActive: true,
      targetType: "NONE",
    },
    {
      id: "b1",
      imageUrl: "https://cdn.example.com/1.jpg",
      sortOrder: 1,
      createdAt: "2026-01-01",
      isActive: true,
      targetType: "NONE",
    },
  ], { now: NOW });
  assert.deepEqual(result.map((b) => b.id), ["b1", "b2"]);
}

function testSensitiveFieldsNotReturned() {
  const result = filterHomeBannersForMiniprogram([
    {
      id: "b1",
      imageUrl: "https://cdn.example.com/banner.jpg",
      sortOrder: 1,
      isActive: true,
      targetType: "NONE",
      note: "后台备注",
      internalRemark: "内部",
    },
  ], { now: NOW });
  const banner = result[0] as Record<string, unknown>;
  assert.equal("note" in banner, false);
  assert.equal("internalRemark" in banner, false);
}

function run() {
  testActiveBannerReturns();
  testInactiveHidden();
  testSoftDeletedHidden();
  testStartsAtFutureHidden();
  testEndsAtPastHidden();
  testLocalhostNormalizedNotReturned();
  testNoJumpAllowed();
  testStableSort();
  testSensitiveFieldsNotReturned();
  console.log("banner-rules-pure.test.ts: all tests passed");
}

run();
