/** Stable prefix for system-generated inventory batch identifiers. */
export const BATCH_NUMBER_PREFIX = "BATCH";
export const PRODUCT_CODE_PREFIX = "PRD";
export const SKU_CODE_PREFIX = "SKU";
export const SAMPLE_CODE_PREFIX = "SMP";

const ENTROPY_PATTERN = /^[0-9A-Za-z-]+$/;

/**
 * Builds an opaque, readable batch number from server-generated entropy.
 * The date is formatted in UTC so the identifier is stable across time zones.
 * Callers pass the clock and entropy explicitly, keeping this helper pure and
 * its tests deterministic without mocking global randomness.
 */
export function generateBatchNumber(now: Date, entropy: string): string {
  return generateDatedIdentifier(BATCH_NUMBER_PREFIX, now, entropy);
}

export function generateProductCode(now: Date, entropy: string): string {
  return generateDatedIdentifier(PRODUCT_CODE_PREFIX, now, entropy);
}

export function generateSkuCode(now: Date, entropy: string): string {
  return generateDatedIdentifier(SKU_CODE_PREFIX, now, entropy);
}

export function generateSampleCode(now: Date, entropy: string): string {
  return generateDatedIdentifier(SAMPLE_CODE_PREFIX, now, entropy);
}

function generateDatedIdentifier(prefix: string, now: Date, entropy: string): string {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Identifier date must be valid");
  }
  if (!ENTROPY_PATTERN.test(entropy) || entropy.trim() !== entropy) {
    throw new Error("Identifier entropy must be non-empty alphanumeric text");
  }
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${date}-${entropy}`;
}
