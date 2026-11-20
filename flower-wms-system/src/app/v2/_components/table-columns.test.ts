import assert from "node:assert/strict";
import {
  V2_COLUMN_WIDTH,
  v2ColumnWidth,
  type V2ColumnField,
} from "./table-columns";

/**
 * Run with: npx tsx src/app/v2/_components/table-columns.test.ts
 *
 * Field-based widths are a sizing contract, not a visual afterthought: text
 * fields must keep the agreed ten-CJK-character minimum, names get extra room,
 * and compact fields must not inherit the text minimum.
 */

const TEXT_FIELDS: V2ColumnField[] = ["code", "name", "text", "status", "date"];
/**
 * Compact material-master fields keep five (`short`) or seven (`medium`) CJK
 * glyphs. They must stay narrower than generic free text while still reserving
 * enough room for role/colour/unit and classification/spec values.
 */
const COMPACT_FIELDS: Partial<Record<V2ColumnField, number>> = {
  short: 5,
  medium: 7,
};

function emValue(field: V2ColumnField): number {
  const width = V2_COLUMN_WIDTH[field];
  const match = /^calc\((\d+(?:\.\d+)?)em \+ 2rem\)$/.exec(width);
  assert.ok(match, `${field} must use the calc(<n>em + 2rem) form, got ${width}`);
  return Number(match[1]);
}

function remValue(field: V2ColumnField): number {
  const width = V2_COLUMN_WIDTH[field];
  const match = /^(\d+(?:\.\d+)?)rem$/.exec(width);
  assert.ok(match, `${field} must use a rem width, got ${width}`);
  return Number(match[1]);
}

function main(): void {
  const fields = Object.keys(V2_COLUMN_WIDTH) as V2ColumnField[];
  assert.equal(fields.length, 10, "every supported field has one width");

  for (const field of TEXT_FIELDS) {
    assert.ok(
      emValue(field) >= 10,
      `${field} must fit at least ten CJK characters, got ${V2_COLUMN_WIDTH[field]}`,
    );
  }

  for (const [field, minimum] of Object.entries(COMPACT_FIELDS) as [V2ColumnField, number][]) {
    assert.ok(
      emValue(field) >= minimum,
      `${field} must fit at least ${minimum} CJK characters, got ${V2_COLUMN_WIDTH[field]}`,
    );
    assert.ok(
      emValue(field) < emValue("text"),
      `${field} stays narrower than generic free text`,
    );
  }

  assert.ok(emValue("short") < emValue("medium"), "short labels are narrower than classifications");
  assert.ok(emValue("name") > emValue("text"), "names get more room than generic text");
  assert.ok(emValue("code") >= emValue("text"), "codes do not shrink below generic text");
  assert.ok(emValue("numeric") < emValue("text"), "numeric columns stay compact");
  assert.ok(remValue("image") < 10, "image columns do not reserve text width");
  assert.equal(remValue("action"), 14, "the action column matches the shared w-56 sticky cell");

  assert.deepEqual(v2ColumnWidth("name"), { minWidth: V2_COLUMN_WIDTH.name });
  assert.deepEqual(v2ColumnWidth("image"), { minWidth: "5.5rem" });
  assert.deepEqual(v2ColumnWidth("short"), { minWidth: "calc(5em + 2rem)" });
  assert.deepEqual(v2ColumnWidth("medium"), { minWidth: "calc(7em + 2rem)" });

  console.log("table-columns.test.ts passed");
}

main();
