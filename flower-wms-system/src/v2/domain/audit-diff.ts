/**
 * Pure AuditEvent change-summary rules.
 *
 * Audit snapshots are shallow JSON objects written by V2 services (state before
 * and after an action). This module turns them into a small, readable change
 * list without assuming any specific entity shape.
 */

export type AuditChangeKind = "ADDED" | "REMOVED" | "CHANGED";

export type AuditChange = {
  field: string;
  before: string | null;
  after: string | null;
  kind: AuditChangeKind;
};

export type AuditChangeSummary = {
  changes: AuditChange[];
  summary: string;
  hasSnapshot: boolean;
};

const MAX_VALUE_LENGTH = 80;
const MAX_SUMMARY_CHANGES = 5;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatAuditValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  // Count code points, not UTF-16 units: a blind slice could split a surrogate
  // pair (for example an emoji in a material or product name) and render a
  // replacement character instead of a readable truncation.
  const characters = Array.from(text);
  if (characters.length > MAX_VALUE_LENGTH) {
    return `${characters.slice(0, MAX_VALUE_LENGTH).join("")}…`;
  }
  return text;
}

function comparable(value: unknown): string {
  if (value === undefined) return "__undefined__";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Builds a field-level diff. Only top-level fields are inspected; nested
 * snapshots are compared as serialized values and shown truncated.
 */
export function summarizeAuditChange(before: unknown, after: unknown): AuditChangeSummary {
  const hasSnapshot = before != null || after != null;
  if (!isPlainObject(before) && !isPlainObject(after)) {
    if (before == null && after == null) {
      return { changes: [], summary: "无变更快照", hasSnapshot: false };
    }
    const beforeText = formatAuditValue(before);
    const afterText = formatAuditValue(after);
    const changes: AuditChange[] = [{
      field: "value",
      before: beforeText,
      after: afterText,
      kind: before == null ? "ADDED" : after == null ? "REMOVED" : "CHANGED",
    }];
    return {
      changes,
      summary: describeChanges(changes),
      hasSnapshot: true,
    };
  }

  const beforeObject = isPlainObject(before) ? before : {};
  const afterObject = isPlainObject(after) ? after : {};
  const fields = [...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])].sort();
  const changes: AuditChange[] = [];
  for (const field of fields) {
    const beforeValue = beforeObject[field];
    const afterValue = afterObject[field];
    if (comparable(beforeValue) === comparable(afterValue)) continue;
    changes.push({
      field,
      before: formatAuditValue(beforeValue),
      after: formatAuditValue(afterValue),
      kind: beforeValue === undefined || beforeValue === null
        ? "ADDED"
        : afterValue === undefined || afterValue === null
          ? "REMOVED"
          : "CHANGED",
    });
  }

  return {
    changes,
    summary: changes.length === 0 ? "无字段变更" : describeChanges(changes),
    hasSnapshot,
  };
}

function describeChanges(changes: readonly AuditChange[]): string {
  const shown = changes.slice(0, MAX_SUMMARY_CHANGES).map((change) => {
    if (change.kind === "ADDED") return `${change.field}=${change.after ?? "—"}`;
    if (change.kind === "REMOVED") return `${change.field}: ${change.before ?? "—"} → —`;
    return `${change.field}: ${change.before ?? "—"} → ${change.after ?? "—"}`;
  });
  const remaining = changes.length - shown.length;
  return remaining > 0 ? `${shown.join("；")}；等 ${changes.length} 项` : shown.join("；");
}
