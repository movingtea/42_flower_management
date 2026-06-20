import assert from "node:assert/strict";
import {
  normalizeDisinfectant,
  normalizeMainWater,
  normalizeNutrient,
  normalizePruneMethod,
  normalizeWakeWater,
  normalizeAiCareTable,
} from "./material-care-normalizer";
import { parseFlowerAiJson } from "@/lib/wiki-care";

function testWakeWaterLongSentence() {
  assert.equal(
    normalizeWakeWater("建议使用深水醒花，将花茎充分浸入水中……"),
    "需要深水醒花"
  );
  assert.equal(normalizeWakeWater("不需要深水醒花"), "不需要深水醒花");
  assert.equal(normalizeWakeWater("无需深水醒花处理"), "不需要深水醒花");
}

function testMainWaterShallow() {
  assert.equal(normalizeMainWater("浅水养护即可"), "浅水养护");
  assert.equal(normalizeMainWater("深水养护"), "深水养护");
}

function testPruneMethodCross() {
  assert.equal(
    normalizePruneMethod("45度斜切，并可十字劈开"),
    "45度斜切 + 十字劈开"
  );
  assert.equal(
    normalizePruneMethod("45度斜切，无需十字劈开"),
    "45度斜切，无需十字劈开"
  );
  assert.equal(normalizePruneMethod("45度斜切"), "45度斜切");
}

function testNutrientSymbols() {
  assert.equal(normalizeNutrient("建议添加鲜花营养液"), "✓");
  assert.equal(normalizeNutrient("不需要添加"), "✗");
  assert.equal(normalizeNutrient("✓"), "✓");
  assert.equal(normalizeNutrient("✗"), "✗");
}

function testDisinfectantDose() {
  assert.equal(
    normalizeDisinfectant("可按1L水加1-2滴84消毒液"),
    "✓，1L水加1-2滴"
  );
  assert.equal(normalizeDisinfectant("不建议使用84消毒液"), "✗");
  assert.equal(normalizeDisinfectant("✓，1L水加1滴"), "✓，1L水加1滴");
  assert.equal(normalizeDisinfectant("✓，2L水加1-2滴"), "✓，2L水加1-2滴");
}

function testNormalizeAiCareTablePreservesOtherFields() {
  const rows = normalizeAiCareTable([
    {
      key: "wakeWater",
      label: "醒花水位",
      value: "建议使用深水醒花，将花茎充分浸入水中……",
    },
    {
      key: "frequency",
      label: "换水频率",
      value: "每2天换水一次",
    },
    {
      key: "notes",
      label: "注意事项",
      value: "避开空调出风口",
    },
  ]);

  assert.equal(rows[0]?.value, "需要深水醒花");
  assert.equal(rows[1]?.value, "每2天换水一次");
  assert.equal(rows[2]?.value, "避开空调出风口");
}

function testParseFlowerAiJsonAppliesNormalizer() {
  const raw = JSON.stringify({
    latinName: "Rosa hybrida",
    englishName: "Rose",
    flowerLanguage: "热烈的爱",
    careTable: [
      {
        key: "wakeWater",
        label: "醒花水位",
        value: "建议使用深水醒花，将花茎充分浸入水中……",
      },
      { key: "mainWater", label: "养护水位", value: "浅水养护即可" },
      {
        key: "pruneMethod",
        label: "剪根方法",
        value: "45度斜切，并可十字劈开",
      },
      { key: "nutrient", label: "鲜花营养液", value: "建议添加鲜花营养液" },
      {
        key: "disinfectant",
        label: "84消毒液",
        value: "可按1L水加1-2滴84消毒液",
      },
      { key: "frequency", label: "换水频率", value: "每2天换水" },
      { key: "notes", label: "注意事项", value: "避光通风" },
    ],
  });

  const parsed = parseFlowerAiJson(raw);
  assert.equal(parsed.latinName, "Rosa hybrida");
  assert.equal(parsed.englishName, "Rose");
  assert.equal(parsed.flowerLanguage, "热烈的爱");

  const byKey = new Map(parsed.careTable.map((row) => [row.key, row.value]));
  assert.equal(byKey.get("wakeWater"), "需要深水醒花");
  assert.equal(byKey.get("mainWater"), "浅水养护");
  assert.equal(byKey.get("pruneMethod"), "45度斜切 + 十字劈开");
  assert.equal(byKey.get("nutrient"), "✓");
  assert.equal(byKey.get("disinfectant"), "✓，1L水加1-2滴");
  assert.equal(byKey.get("frequency"), "每2天换水");
  assert.equal(byKey.get("notes"), "避光通风");
}

testWakeWaterLongSentence();
testMainWaterShallow();
testPruneMethodCross();
testNutrientSymbols();
testDisinfectantDose();
testNormalizeAiCareTablePreservesOtherFields();
testParseFlowerAiJsonAppliesNormalizer();

console.log("material-care-normalizer.test.ts: all passed");
