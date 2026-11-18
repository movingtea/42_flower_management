import assert from "node:assert/strict";
import { formatAuditValue, summarizeAuditChange } from "./audit-diff";

function testEmpty() {
  assert.deepEqual(summarizeAuditChange(null, null), {
    changes: [],
    summary: "无变更快照",
    hasSnapshot: false,
  });
  assert.deepEqual(summarizeAuditChange(undefined, undefined), {
    changes: [],
    summary: "无变更快照",
    hasSnapshot: false,
  });
  assert.deepEqual(summarizeAuditChange({}, {}), {
    changes: [],
    summary: "无字段变更",
    hasSnapshot: true,
  });
}

function testObjectDiff() {
  const result = summarizeAuditChange(
    { state: "DRAFT", quantity: 10, removed: "x", nested: { a: 1 }, extra1: 1, extra2: 2 },
    { state: "ORDERED", quantity: 10, added: "y", nested: { a: 2 }, extra1: 3, extra2: 4 },
  );
  assert.equal(result.hasSnapshot, true);
  assert.deepEqual(
    result.changes.map((change) => change.field),
    ["added", "extra1", "extra2", "nested", "removed", "state"],
  );
  assert.equal(result.changes.find((c) => c.field === "state")?.kind, "CHANGED");
  assert.equal(result.changes.find((c) => c.field === "added")?.kind, "ADDED");
  assert.equal(result.changes.find((c) => c.field === "removed")?.kind, "REMOVED");
  assert.match(result.summary, /added=y/);
  assert.match(result.summary, /等 6 项/);
}

function testOneSidedSnapshots() {
  // Only an after snapshot: every object field reads as ADDED.
  const created = summarizeAuditChange(null, { state: "CONFIRMED", quantity: 2 });
  assert.equal(created.hasSnapshot, true);
  assert.deepEqual(
    created.changes.map((change) => [change.field, change.kind, change.before, change.after]),
    [
      ["quantity", "ADDED", null, "2"],
      ["state", "ADDED", null, "CONFIRMED"],
    ],
  );
  assert.match(created.summary, /quantity=2/);

  // Only a before snapshot: every object field reads as REMOVED.
  const deleted = summarizeAuditChange({ state: "DRAFT", quantity: 3 }, null);
  assert.deepEqual(
    deleted.changes.map((change) => [change.field, change.kind]),
    [
      ["quantity", "REMOVED"],
      ["state", "REMOVED"],
    ],
  );
  assert.match(deleted.summary, /quantity: 3 → —/);

  // null → {} is a snapshot, just without any fields to show.
  assert.deepEqual(summarizeAuditChange(null, {}), {
    changes: [],
    summary: "无字段变更",
    hasSnapshot: true,
  });
}

function testNestedAndArrayValues() {
  const nested = summarizeAuditChange(
    { nested: { a: 1, list: [1, 2] }, tags: ["a"] },
    { nested: { a: 2, list: [1, 2] }, tags: ["a", "b"] },
  );
  assert.deepEqual(nested.changes.map((change) => change.field), ["nested", "tags"]);
  const nestedChange = nested.changes.find((change) => change.field === "nested");
  assert.equal(nestedChange?.kind, "CHANGED");
  assert.equal(nestedChange?.before, '{"a":1,"list":[1,2]}');
  assert.equal(nestedChange?.after, '{"a":2,"list":[1,2]}');
  assert.equal(nested.changes.find((change) => change.field === "tags")?.kind, "CHANGED");

  // Arrays are not plain objects; they become a single `value` change instead
  // of being expanded into numeric field names.
  const arrays = summarizeAuditChange([1, 2], [1, 3]);
  assert.equal(arrays.changes.length, 1);
  assert.equal(arrays.changes[0]?.field, "value");
  assert.equal(arrays.changes[0]?.kind, "CHANGED");
}

function testNonObjectDiff() {
  const added = summarizeAuditChange(null, "created");
  assert.equal(added.changes[0].kind, "ADDED");
  assert.equal(added.summary, "value=created");

  const removed = summarizeAuditChange("old", null);
  assert.equal(removed.changes[0].kind, "REMOVED");
  assert.match(removed.summary, /old/);

  const changed = summarizeAuditChange(1, 2);
  assert.equal(changed.changes[0].kind, "CHANGED");
  assert.equal(changed.summary, "value: 1 → 2");
}

function testFormatting() {
  assert.equal(formatAuditValue(null), null);
  assert.equal(formatAuditValue(undefined), null);
  assert.equal(formatAuditValue(12.5), "12.5");
  assert.equal(formatAuditValue(true), "true");
  assert.equal(formatAuditValue("x".repeat(100))?.length, 81);
  assert.match(formatAuditValue({ a: 1 }) ?? "", /"a":1/);
}

function testUnicodeTruncation() {
  // Chinese text is one code point per character and stays readable.
  assert.equal(formatAuditValue("花材".repeat(50))?.length, 81);

  // Truncation counts code points, so an emoji surrogate pair is never split
  // in half (which would render as U+FFFD).
  const emoji = formatAuditValue("🌷".repeat(100));
  assert.equal(emoji, `${"🌷".repeat(80)}…`);
  assert.equal(Array.from(emoji ?? "").length, 81);
  assert.equal(emoji?.includes("\uFFFD"), false);

  const mixed = formatAuditValue(`订单${"🌷".repeat(200)}`);
  assert.ok(mixed);
  assert.equal(mixed.includes("\uFFFD"), false);
  assert.equal(Array.from(mixed).slice(-1)[0], "…");
  assert.equal(Array.from(mixed).length, 81);
}

function run() {
  testEmpty();
  testObjectDiff();
  testOneSidedSnapshots();
  testNestedAndArrayValues();
  testNonObjectDiff();
  testFormatting();
  testUnicodeTruncation();
  console.log("v2 audit diff tests passed");
}

run();
