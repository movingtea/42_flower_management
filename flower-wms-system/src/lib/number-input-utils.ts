/** 数字输入框纯函数（可单测） */

export function isValidIntegerDraft(draft: string): boolean {
  if (draft === "" || draft === "-") return true;
  return /^-?\d*$/.test(draft);
}

export function isValidDecimalDraft(draft: string): boolean {
  if (draft === "" || draft === "-" || draft === ".") return true;
  return /^-?\d*\.?\d*$/.test(draft);
}

export function formatNumberDraft(
  value: number | null | undefined,
  integerOnly: boolean
): string {
  if (value == null || Number.isNaN(value)) return "";
  return integerOnly ? String(Math.trunc(value)) : String(value);
}

export function parseIntegerDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "" || trimmed === "-") return null;
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseDecimalDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === ".") return null;
  const parsed = parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clampNumber(
  value: number,
  min?: number,
  max?: number
): number {
  let next = value;
  if (min != null && next < min) next = min;
  if (max != null && next > max) next = max;
  return next;
}
