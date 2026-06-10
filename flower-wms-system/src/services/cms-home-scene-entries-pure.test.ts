/**
 * 纯函数单测 — 运行：npm run test:cms-home-scene-entries
 */
import assert from "node:assert/strict";
import { GiftOccasionType, HomeSceneEntryTargetType } from "@/generated/prisma/enums";
import {
  buildFallbackMiniProgramEntries,
  getDefaultEntryDefsForMissingSceneTypes,
  getMissingDefaultSceneTypes,
  normalizeTargetType,
  resolveIconKey,
  sceneTypeToIconKey,
  sortHomeSceneEntries,
  toMiniProgramHomeSceneEntry,
} from "./cms-home-scene-entries-pure";

function testFallbackEntries() {
  const entries = buildFallbackMiniProgramEntries();
  assert.equal(entries.length, 6);
  assert.equal(entries[0]?.sceneType, GiftOccasionType.BIRTHDAY);
  assert.equal(entries[0]?.source, "FALLBACK");
  assert.equal(entries[0]?.targetType, HomeSceneEntryTargetType.PRODUCT_FILTER);
}

function testSortEntries() {
  const sorted = sortHomeSceneEntries([
    { sortOrder: 30, id: "c" },
    { sortOrder: 10, id: "a" },
    { sortOrder: 20, id: "b" },
  ]);
  assert.deepEqual(sorted.map((e) => e.id), ["a", "b", "c"]);
}

function testNormalizeTargetType() {
  assert.equal(
    normalizeTargetType(HomeSceneEntryTargetType.CUSTOM_URL),
    HomeSceneEntryTargetType.CUSTOM_URL
  );
  assert.equal(
    normalizeTargetType(null),
    HomeSceneEntryTargetType.PRODUCT_FILTER
  );
  assert.equal(
    normalizeTargetType("invalid"),
    HomeSceneEntryTargetType.PRODUCT_FILTER
  );
}

function testIconKeyFallback() {
  assert.equal(resolveIconKey("birthday"), "birthday");
  assert.equal(resolveIconKey("unknown-key"), "fallback");
  assert.equal(resolveIconKey(null, GiftOccasionType.VISIT), "visit");
  assert.equal(resolveIconKey("", null), "fallback");
}

function testSceneTypeToIconKey() {
  assert.equal(sceneTypeToIconKey(GiftOccasionType.MOTHERS_DAY), "mothers-day");
  assert.equal(sceneTypeToIconKey("UNKNOWN"), "fallback");
}

function testToMiniProgramEntry() {
  const entry = toMiniProgramHomeSceneEntry({
    id: "1",
    title: "生日",
    subtitle: "副标题",
    sceneType: GiftOccasionType.BIRTHDAY,
    iconKey: "",
    sortOrder: 10,
    targetType: null,
    targetValue: null,
    linkedRecommendationSlotKey: null,
    source: "CMS",
  });
  assert.equal(entry.iconKey, "birthday");
  assert.equal(entry.targetType, HomeSceneEntryTargetType.PRODUCT_FILTER);
  assert.equal(entry.targetValue, GiftOccasionType.BIRTHDAY);
}

function testMergeDefaultMissing() {
  assert.deepEqual(
    getMissingDefaultSceneTypes([GiftOccasionType.BIRTHDAY]),
    [
      GiftOccasionType.ANNIVERSARY,
      GiftOccasionType.VISIT,
      GiftOccasionType.APOLOGY,
      GiftOccasionType.BUSINESS,
      GiftOccasionType.DAILY_SURPRISE,
    ]
  );
  const defs = getDefaultEntryDefsForMissingSceneTypes([
    GiftOccasionType.BIRTHDAY,
    GiftOccasionType.VISIT,
  ]);
  assert.equal(defs.length, 4);
  assert.ok(!defs.some((d) => d.sceneType === GiftOccasionType.BIRTHDAY));
}

function run() {
  testFallbackEntries();
  testSortEntries();
  testNormalizeTargetType();
  testIconKeyFallback();
  testSceneTypeToIconKey();
  testToMiniProgramEntry();
  testMergeDefaultMissing();
  console.log("cms-home-scene-entries-pure: all tests passed");
}

run();
