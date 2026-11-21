/**
 * Readable sample identity for V2 pickers and compact cards.
 *
 * Samples get a system-generated `SMP-YYYYMMDD-<entropy>` code, but some rows
 * were created with a full UUID as entropy, producing very long codes that
 * dominate a picker before the human-readable name. Sample pickers therefore
 * display only the name; a short code is used solely as a defensive fallback
 * when the name is empty or identical to the code.
 *
 * Presentation-only: no identifier is changed or persisted here.
 */

export type SampleDisplayLike = {
  code: string;
  name: string;
};

const SHORT_CODE_MAX_LENGTH = 12;
const SHORT_CODE_TAIL_LENGTH = 6;

/** Compact fallback form of a generated sample code. */
export function shortSampleCode(code: string): string {
  const trimmed = code.trim();
  if (trimmed.length <= SHORT_CODE_MAX_LENGTH) return trimmed;
  const compact = trimmed.replace(/[^0-9A-Za-z]/gu, "");
  if (!compact) return trimmed;
  const tail = compact.slice(-SHORT_CODE_TAIL_LENGTH).toUpperCase();
  const separator = trimmed.indexOf("-");
  const prefix = separator > 0 ? trimmed.slice(0, separator) : "";
  return prefix ? `${prefix}-…${tail}` : `…${tail}`;
}

/**
 * Human label for a sample: the name when it is meaningful, otherwise the
 * short code (defensive fallback for imported or legacy rows whose name is
 * empty or identical to the code).
 */
export function sampleDisplayName(sample: SampleDisplayLike): string {
  const name = sample.name.trim();
  const code = sample.code.trim();
  if (name && name !== code) return name;
  return shortSampleCode(code);
}
