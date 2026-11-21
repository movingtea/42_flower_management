import assert from "node:assert/strict";
import {
  summarizeCandidateSelection,
  toggleCandidateSelection,
} from "./sample-plan-selection";

/**
 * Run with: npx tsx src/app/v2/sample-plans/sample-plan-selection.test.ts
 *
 * Pins the recommendation list's select-all behavior, including the
 * `plannedCount - 1` companion cap and manually added samples.
 */

function main(): void {
  const candidates = ["c1", "c2", "c3", "c4", "c5"];

  // Empty selection with room: select candidates in list order.
  const empty = summarizeCandidateSelection([], candidates, 4);
  assert.equal(empty.selectedCount, 0);
  assert.equal(empty.allSelected, false);
  assert.equal(empty.partiallySelected, false);
  assert.equal(empty.disabled, false);
  assert.deepEqual(toggleCandidateSelection([], candidates, 4, false), ["c1", "c2", "c3", "c4"]);

  // Partial selection: preserve it and fill the remaining slots in order.
  assert.deepEqual(
    toggleCandidateSelection(["c3"], candidates, 3, false),
    ["c3", "c1", "c2"],
  );

  // All candidates fit: select all, then clear the candidate selections.
  const allSelected = summarizeCandidateSelection(["c1", "c2", "c3", "c4", "c5"], candidates, 9);
  assert.equal(allSelected.allSelected, true);
  assert.equal(allSelected.partiallySelected, false);
  assert.deepEqual(
    toggleCandidateSelection(["c1", "c2", "c3", "c4", "c5"], candidates, 9, true),
    [],
  );

  // Manual additions count against the companion cap and survive a clear.
  const manual = ["manual-1", "manual-2", "c1", "c2"];
  const capped = summarizeCandidateSelection(manual, candidates, 4);
  assert.equal(capped.selectedCount, 2);
  assert.equal(capped.allSelected, true);
  assert.deepEqual(toggleCandidateSelection(manual, candidates, 4, true), ["manual-1", "manual-2"]);

  // Cap already filled by manual-only picks: the control cannot add a candidate.
  const manualOnly = summarizeCandidateSelection(["manual-1", "manual-2"], candidates, 2);
  assert.equal(manualOnly.selectedCount, 0);
  assert.equal(manualOnly.allSelected, false);
  assert.equal(manualOnly.disabled, true);
  assert.deepEqual(toggleCandidateSelection(["manual-1", "manual-2"], candidates, 2, false), [
    "manual-1",
    "manual-2",
  ]);

  // Empty candidate list and zero companion slots disable the control.
  assert.equal(summarizeCandidateSelection([], [], 4).disabled, true);
  assert.equal(summarizeCandidateSelection([], candidates, 0).disabled, true);

  // A partial selection is indeterminate, not checked.
  const partial = summarizeCandidateSelection(["c1"], candidates, 4);
  assert.equal(partial.selectedCount, 1);
  assert.equal(partial.allSelected, false);
  assert.equal(partial.partiallySelected, true);

  console.log("sample plan selection tests passed");
}

main();
