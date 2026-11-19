import assert from "node:assert/strict";
import { parseFlowerAiKnowledgeFields } from "./deepseek-flower";

/**
 * Run with: npx tsx src/lib/deepseek-flower.test.ts
 *
 * Pure parser test: the DeepSeek HTTP call is not exercised, only the additive
 * material-library contract that must never break the V1 wiki fields.
 */

function testFullPayload(): void {
  const parsed = parseFlowerAiKnowledgeFields(JSON.stringify({
    latinName: "Rosa hybrida",
    englishName: "Rose",
    flowerLanguage: "热烈的爱",
    colorTags: [" 红 ", "香槟色", "红", "", 42],
    morphology: "花头饱满、花瓣层叠",
    supplySeason: "全年",
    floralRole: "main",
    suggestedAliases: ["月季", "刺玫", "月季", " "],
    careTable: [{ key: "wakeWater", label: "醒花水位", value: "需要深水醒花" }],
  }));
  assert.deepEqual(parsed.colorTags, ["红", "香槟色"]);
  assert.equal(parsed.morphology, "花头饱满、花瓣层叠");
  assert.equal(parsed.supplySeason, "全年");
  assert.equal(parsed.floralRole, "MAIN");
  assert.deepEqual(parsed.suggestedAliases, ["月季", "刺玫"]);
}

function testFencedJsonIsAccepted(): void {
  const parsed = parseFlowerAiKnowledgeFields(
    '```json\n{"colorTags":["白"],"floralRole":"FOLIAGE"}\n```',
  );
  assert.deepEqual(parsed.colorTags, ["白"]);
  assert.equal(parsed.floralRole, "FOLIAGE");
}

function testMissingAndMalformedFieldsFallBackToEmpty(): void {
  const legacy = parseFlowerAiKnowledgeFields(JSON.stringify({ latinName: "Rosa" }));
  assert.deepEqual(legacy.colorTags, []);
  assert.deepEqual(legacy.suggestedAliases, []);
  assert.equal(legacy.morphology, null);
  assert.equal(legacy.supplySeason, null);
  assert.equal(legacy.floralRole, null);

  for (const raw of ["", "{not-json", "null", "[]", '"text"']) {
    const parsed = parseFlowerAiKnowledgeFields(raw);
    assert.deepEqual(parsed.colorTags, []);
    assert.equal(parsed.floralRole, null);
  }
}

function testUnknownRoleAndLongValuesAreBounded(): void {
  const parsed = parseFlowerAiKnowledgeFields(JSON.stringify({
    colorTags: Array.from({ length: 12 }, (_, index) => `色${index}`),
    morphology: "花".repeat(400),
    supplySeason: "供货".repeat(80),
    floralRole: "KING",
    suggestedAliases: Array.from({ length: 20 }, (_, index) => `别名${index}`),
  }));
  assert.equal(parsed.colorTags.length, 6);
  assert.equal(parsed.suggestedAliases.length, 8);
  assert.equal(parsed.morphology?.length, 120);
  assert.equal(parsed.supplySeason?.length, 20);
  assert.equal(parsed.floralRole, null);
}

testFullPayload();
testFencedJsonIsAccepted();
testMissingAndMalformedFieldsFallBackToEmpty();
testUnknownRoleAndLongValuesAreBounded();

console.log("deepseek-flower.test.ts: all passed");
