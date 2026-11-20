import assert from "node:assert/strict";
import {
  materialOptionLabel,
  materialPickerDetailLabel,
  materialPickerLabel,
} from "./material-option-label";

/**
 * Run with: npx tsx src/app/v2/_components/material-option-label.test.ts
 *
 * Material pickers share one identity format across purchase orders, receipts,
 * recipes, packaging kits, samples and inventory operations. The submitted
 * value stays the id; only the visible label is derived here.
 */

function main(): void {
  assert.equal(
    materialPickerLabel({ name: "玫瑰", baseUnit: "支" }),
    "玫瑰（支）",
  );
  assert.equal(
    materialPickerLabel({ name: "礼盒", baseUnit: "个", active: false }),
    "礼盒（已停用）（个）",
  );
  assert.equal(
    materialPickerLabel({ name: "   ", baseUnit: "包" }),
    "未命名物料（包）",
  );
  assert.equal(
    materialPickerLabel({ name: "散装花材", baseUnit: "" }),
    "散装花材",
  );

  // Business pickers never show the system-generated material code, even when
  // the caller passes the full master row through to the helper.
  const fullRow = { code: "MAT-20261120-A1B2C3D4", name: "玫瑰", baseUnit: "支" };
  assert.equal(materialPickerLabel(fullRow), "玫瑰（支）");
  assert.ok(!materialPickerLabel(fullRow).includes("MAT-"));

  // Replacement pickers keep grade/colour/spec context, omit the code, and do
  // not repeat classification that is already part of the generated name.
  assert.equal(
    materialPickerDetailLabel({
      name: "玫瑰",
      baseUnit: "支",
      grade: "A级",
      color: "粉色",
      specification: "60cm",
    }),
    "玫瑰（支） · A级 · 粉色 · 60cm",
  );
  assert.equal(
    materialPickerDetailLabel({
      name: "玫瑰 · 粉色",
      baseUnit: "支",
      grade: "A级",
      color: "粉色",
      specification: null,
    }),
    "玫瑰 · 粉色（支） · A级",
  );
  assert.equal(
    materialPickerDetailLabel({ ...fullRow, grade: "A级" }),
    "玫瑰（支） · A级",
  );
  assert.ok(!materialPickerDetailLabel({ ...fullRow, grade: "A级" }).includes("MAT-"));

  // The richer samples label still carries stock/cost context and resolves
  // duplicate names without repeating classification already in the name.
  const material = {
    name: "玫瑰",
    kind: "FLOWER",
    baseUnit: "支",
    availableQty: 12,
    standardUnitCost: 3.5,
    active: true,
    flowerVariety: "玫瑰",
    color: null,
    flowerProductName: null,
  };
  assert.equal(
    materialOptionLabel(material),
    "玫瑰（可用 12支，¥3.50/支）",
  );
  assert.equal(
    materialOptionLabel(material, new Set(["玫瑰"])),
    "玫瑰 · 花材 / 支（可用 12支，¥3.50/支）",
  );
  assert.equal(
    materialOptionLabel({
      ...material,
      availableQty: 0,
      standardUnitCost: null,
      active: false,
    }),
    "玫瑰（停用）（无现货，未设成本）",
  );

  console.log("material-option-label.test.ts passed");
}

main();
