/**
 * Select-all behavior for the creation drawer's recommendation list.
 *
 * The plan caps companions at `maxCompanions` (`plannedCount - 1`). "全选"
 * therefore fills the remaining slots in list order instead of blindly adding
 * every candidate; when the cap is already full it clears the recommendation
 * selections, leaving manually added samples untouched.
 */

export type CandidateSelectionSummary = {
  /** Recommended candidates currently selected. */
  selectedCount: number;
  allSelected: boolean;
  partiallySelected: boolean;
  /** No candidate can be added (empty list, no slots, or cap filled without candidates). */
  disabled: boolean;
};

export function summarizeCandidateSelection(
  selectedIds: readonly string[],
  candidateIds: readonly string[],
  maxCompanions: number,
): CandidateSelectionSummary {
  const candidates = new Set(candidateIds);
  const selectedCount = new Set(selectedIds.filter((id) => candidates.has(id))).size;
  const capReached = new Set(selectedIds).size >= maxCompanions;
  const allSelected = candidateIds.length > 0 && (
    selectedCount >= candidateIds.length || (capReached && selectedCount > 0)
  );
  return {
    selectedCount,
    allSelected,
    partiallySelected: selectedCount > 0 && !allSelected,
    disabled: candidateIds.length === 0
      || maxCompanions <= 0
      || (capReached && selectedCount === 0),
  };
}

/**
 * Toggle the recommendation selection.
 *
 * - `allSelected`: clear the candidate selections, preserving manual additions.
 * - otherwise: add candidates in list order until `maxCompanions` total
 *   companions are selected.
 */
export function toggleCandidateSelection(
  selectedIds: readonly string[],
  candidateIds: readonly string[],
  maxCompanions: number,
  allSelected: boolean,
): string[] {
  const candidates = new Set(candidateIds);
  if (allSelected) {
    return selectedIds.filter((id) => !candidates.has(id));
  }
  const next = [...new Set(selectedIds)];
  const selected = new Set(next);
  for (const id of candidateIds) {
    if (next.length >= maxCompanions) break;
    if (selected.has(id)) continue;
    next.push(id);
    selected.add(id);
  }
  return next;
}
