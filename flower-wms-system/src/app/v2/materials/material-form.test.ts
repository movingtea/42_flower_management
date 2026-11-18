import assert from "node:assert/strict";
import { normalizeCareTable } from "@/lib/wiki-care";
import { parseMaterialForm } from "./material-form";

/**
 * Run with: npx tsx src/app/v2/materials/material-form.test.ts
 *
 * In the confined sandbox used for this task, esbuild's child-process service is
 * blocked (spawn EPERM). The equivalent fallback command is:
 * node --experimental-strip-types --import ./scripts/ts-path-loader.mjs src/app/v2/materials/material-form.test.ts
 */

type CareDocument = {
  v: number;
  careTable: Array<{ key: string; label: string; value: string }>;
};

function materialForm(
  overrides: Record<string, string | string[]> = {},
): FormData {
  const form = new FormData();
  form.set("code", "MAT-001");
  form.set("name", "玫瑰");
  form.set("kind", "FLOWER");
  form.set("color", "红");
  form.set("grade", "A");
  form.set("gradeSpecification", "40-50cm");
  form.set("specification", "单头");
  form.set("baseUnit", "支");
  form.set("quantityScale", "0");
  form.set("reservePerOrder", "on");
  for (const [key, value] of Object.entries(overrides)) {
    form.delete(key);
    if (Array.isArray(value)) {
      for (const entry of value) form.append(key, entry);
    } else {
      form.set(key, value);
    }
  }
  return form;
}

function testBasicFieldsAndBlankOptionals() {
  const parsed = parseMaterialForm(materialForm());
  assert.equal(parsed.code, "MAT-001");
  assert.equal(parsed.name, "玫瑰");
  assert.equal(parsed.kind, "FLOWER");
  assert.equal(parsed.color, "红");
  assert.equal(parsed.baseUnit, "支");
  assert.equal(parsed.quantityScale, 0);
  assert.equal(parsed.reservePerOrder, true);
  assert.equal(parsed.englishName, null);
  assert.equal(parsed.flowerLanguage, null);
  assert.equal(parsed.maintenance, null);
  assert.equal(parsed.maintenanceCare, null);
  assert.equal(parsed.supplySeason, null);
  assert.equal(parsed.defaultShelfLifeDays, null);
  assert.equal(parsed.standardUnitCost, null);
  assert.equal(parsed.costUnit, null);
  assert.equal(parsed.costNote, null);
  assert.equal(parsed.optimisticUsableRate, null);
  assert.equal(parsed.standardUsableRate, null);
  assert.equal(parsed.conservativeUsableRate, null);
  assert.equal(parsed.lossRateNote, null);
  assert.equal(parsed.brand, null);
  assert.equal(parsed.model, null);
  assert.equal(parsed.notes, null);
  assert.equal(parsed.safetyStockThreshold, null);
  assert.deepEqual(parsed.categoryIds, []);

  const withoutCheckbox = materialForm();
  withoutCheckbox.delete("reservePerOrder");
  assert.equal(parseMaterialForm(withoutCheckbox).reservePerOrder, false);
}

function testConvertsPercentRates() {
  const parsed = parseMaterialForm(
    materialForm({
      optimisticUsableRate: "92",
      standardUsableRate: "85.5",
      conservativeUsableRate: "0",
    }),
  );
  assert.equal(parsed.optimisticUsableRate, 0.92);
  assert.equal(parsed.standardUsableRate, 0.855);
  assert.equal(parsed.conservativeUsableRate, 0);

  const withSuffix = parseMaterialForm(
    materialForm({ standardUsableRate: "85%" }),
  );
  assert.equal(withSuffix.standardUsableRate, 0.85);

  const atBounds = parseMaterialForm(
    materialForm({
      optimisticUsableRate: "100",
      conservativeUsableRate: "0.5",
    }),
  );
  assert.equal(atBounds.optimisticUsableRate, 1);
  assert.equal(atBounds.conservativeUsableRate, 0.005);
}

function testKnowledgeAndMasterPartFieldsPassThrough() {
  const parsed = parseMaterialForm(
    materialForm({
      englishName: "Rosa hybrida / Rose",
      flowerLanguage: "热烈的爱",
      supplySeason: "全年",
      defaultShelfLifeDays: "7",
      standardUnitCost: "12.5",
      costUnit: "支",
      costNote: "近 30 天均价",
      lossRateNote: "夏季偏高",
      brand: "测试品牌",
      model: "M-1",
      notes: "测试备注",
      safetyStockThreshold: "3.5",
    }),
  );
  assert.equal(parsed.englishName, "Rosa hybrida / Rose");
  assert.equal(parsed.flowerLanguage, "热烈的爱");
  assert.equal(parsed.supplySeason, "全年");
  assert.equal(parsed.defaultShelfLifeDays, "7");
  assert.equal(parsed.standardUnitCost, "12.5");
  assert.equal(parsed.costUnit, "支");
  assert.equal(parsed.costNote, "近 30 天均价");
  assert.equal(parsed.lossRateNote, "夏季偏高");
  assert.equal(parsed.brand, "测试品牌");
  assert.equal(parsed.model, "M-1");
  assert.equal(parsed.notes, "测试备注");
  assert.equal(parsed.safetyStockThreshold, "3.5");
}

function testCareTableJsonDerivesMaintenance() {
  const rows = [
    { key: "wakeWater", label: "醒花水位", value: "需要深水醒花" },
    { key: "frequency", label: "换水频率", value: "每2天换水" },
  ];
  const parsed = parseMaterialForm(
    materialForm({ careTable: JSON.stringify(rows) }),
  );
  assert.equal(parsed.maintenance, "醒花水位：需要深水醒花\n换水频率：每2天换水");
  const document = parsed.maintenanceCare as CareDocument;
  assert.equal(document.v, 1);
  assert.equal(document.careTable.length, 7);
  assert.deepEqual(document.careTable, normalizeCareTable(rows));
  assert.equal(document.careTable[0]?.value, "需要深水醒花");
  assert.equal(document.careTable[5]?.value, "每2天换水");
}

function testMaintenanceTextWinsAndEmptyTablesBecomeNull() {
  const manual = parseMaterialForm(
    materialForm({
      maintenance: "  手写养护说明  ",
      careTable: JSON.stringify([
        { key: "wakeWater", label: "醒花水位", value: "需要深水醒花" },
      ]),
    }),
  );
  assert.equal(manual.maintenance, "手写养护说明");
  assert.ok(manual.maintenanceCare);

  const blankRows = parseMaterialForm(
    materialForm({
      careTable: JSON.stringify(
        normalizeCareTable([]).map((row) => ({ ...row, value: "   " })),
      ),
    }),
  );
  assert.equal(blankRows.maintenanceCare, null);
  assert.equal(blankRows.maintenance, null);

  const emptyArray = parseMaterialForm(materialForm({ careTable: "[]" }));
  assert.equal(emptyArray.maintenanceCare, null);
  assert.equal(emptyArray.maintenance, null);
}

function testCategoryIdsAreTrimmedDedupedAndFiltered() {
  const parsed = parseMaterialForm(
    materialForm({ categoryIds: [" cat-1 ", "cat-2", "", "cat-1", "  "] }),
  );
  assert.deepEqual(parsed.categoryIds, ["cat-1", "cat-2"]);
}

function testInvalidPercentRatesThrowChineseErrors() {
  for (const [field, label] of [
    ["optimisticUsableRate", "乐观可用率"],
    ["standardUsableRate", "标准可用率"],
    ["conservativeUsableRate", "保守可用率"],
  ] as const) {
    assert.throws(
      () => parseMaterialForm(materialForm({ [field]: "101" })),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(label) &&
        error.message.includes("0–100"),
    );
    assert.throws(
      () => parseMaterialForm(materialForm({ [field]: "abc" })),
      (error: unknown) =>
        error instanceof Error && error.message.includes(label),
    );
  }
  assert.throws(
    () => parseMaterialForm(materialForm({ standardUsableRate: "-1" })),
    /标准可用率必须在 0–100 之间/,
  );
}

function testInvalidCareTableJsonThrows() {
  assert.throws(
    () => parseMaterialForm(materialForm({ careTable: "{not-json" })),
    /养护指南表格格式无效/,
  );
  assert.throws(
    () =>
      parseMaterialForm(
        materialForm({ careTable: JSON.stringify({ careTable: [] }) }),
      ),
    /养护指南表格格式无效/,
  );
  assert.throws(
    () =>
      parseMaterialForm(
        materialForm({ careTable: JSON.stringify([{ value: "只有值" }]) }),
      ),
    /养护指南表格格式无效/,
  );
}

testBasicFieldsAndBlankOptionals();
testConvertsPercentRates();
testKnowledgeAndMasterPartFieldsPassThrough();
testCareTableJsonDerivesMaintenance();
testMaintenanceTextWinsAndEmptyTablesBecomeNull();
testCategoryIdsAreTrimmedDedupedAndFiltered();
testInvalidPercentRatesThrowChineseErrors();
testInvalidCareTableJsonThrows();

console.log("material-form.test.ts: all passed");
