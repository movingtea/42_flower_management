import assert from "node:assert/strict";
import { V2_COLUMN_WIDTH, type V2ColumnField } from "../../_components/table-columns";
import { materialColumnFields } from "./material-columns";

/**
 * Run with: npx tsx src/app/v2/materials/_components/material-columns.test.ts
 *
 * The material masters have twelve columns. Their order must match the header
 * and row markup exactly, and the flower classification columns must use the
 * compact widths instead of reserving ten CJK glyphs for two-to-five-character
 * values.
 */

/** `em` resolves against the table's `text-sm` font size (0.875rem). */
const EM_IN_REM = 0.875;

function widthInRem(field: V2ColumnField): number {
  const width = V2_COLUMN_WIDTH[field];
  const calc = /^calc\((\d+(?:\.\d+)?)em \+ 2rem\)$/.exec(width);
  if (calc) return Number(calc[1]) * EM_IN_REM + 2;
  const rem = /^(\d+(?:\.\d+)?)rem$/.exec(width);
  assert.ok(rem, `${field} must use a supported width, got ${width}`);
  return Number(rem[1]);
}

function totalWidth(fields: readonly V2ColumnField[]): number {
  return fields.reduce((sum, field) => sum + widthInRem(field), 0);
}

function main(): void {
  const flower = materialColumnFields(true);
  const consumable = materialColumnFields(false);

  assert.deepEqual(flower, [
    "image", "code", "name", "short",
    "short", "medium", "short", "medium",
    "short", "numeric", "status", "action",
  ]);
  assert.deepEqual(consumable, [
    "image", "code", "name", "short",
    "medium", "medium", "medium", "short",
    "numeric", "numeric", "status", "action",
  ]);
  assert.equal(flower.length, 12, "flower master has twelve columns");
  assert.equal(consumable.length, 12, "consumable master has twelve columns");

  // Every classification/unit column is compact; none keeps the generic text
  // width that previously made the flower table far wider than its content.
  assert.ok(!flower.includes("text"));
  assert.ok(!consumable.includes("text"));
  assert.equal(flower.filter((field) => field === "short").length, 4);
  assert.equal(flower.filter((field) => field === "medium").length, 2);

  // The compact split must reduce the declared table width by at least 10%.
  const oldFlower = flower.map((field) =>
    field === "short" || field === "medium" ? "text" as const : field,
  );
  const oldConsumable = consumable.map((field) =>
    field === "short" || field === "medium" ? "text" as const : field,
  );
  assert.ok(
    totalWidth(flower) < totalWidth(oldFlower) * 0.9,
    `flower width ${totalWidth(flower)}rem should be < 90% of ${totalWidth(oldFlower)}rem`,
  );
  assert.ok(
    totalWidth(consumable) < totalWidth(oldConsumable) * 0.9,
    `consumable width ${totalWidth(consumable)}rem should be < 90% of ${totalWidth(oldConsumable)}rem`,
  );

  console.log("material-columns.test.ts passed");
}

main();
