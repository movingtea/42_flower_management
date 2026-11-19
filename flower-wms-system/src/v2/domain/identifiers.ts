/** Stable prefix for system-generated inventory batch identifiers. */
export const BATCH_NUMBER_PREFIX = "BATCH";
export const PRODUCT_CODE_PREFIX = "PRD";
export const SKU_CODE_PREFIX = "SKU";
export const SAMPLE_CODE_PREFIX = "SMP";
export const MATERIAL_CODE_PREFIX = "MAT";
export const SUPPLIER_CODE_PREFIX = "SUP";
export const PACKAGING_KIT_CODE_PREFIX = "PKG";
export const PURCHASE_ORDER_NUMBER_PREFIX = "PO";

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

export function generateMaterialCode(now: Date, entropy: string): string {
  return generateDatedIdentifier(MATERIAL_CODE_PREFIX, now, entropy);
}

export function generateSupplierCode(now: Date, entropy: string): string {
  return generateDatedIdentifier(SUPPLIER_CODE_PREFIX, now, entropy);
}

export function generatePackagingKitCode(now: Date, entropy: string): string {
  return generateDatedIdentifier(PACKAGING_KIT_CODE_PREFIX, now, entropy);
}

export function generatePurchaseOrderNumber(now: Date, entropy: string): string {
  return generateDatedIdentifier(PURCHASE_ORDER_NUMBER_PREFIX, now, entropy);
}

/**
 * Short, readable entropy for system-generated business identifiers.
 * Kept separate from the pure generators so their tests stay deterministic.
 */
export function generateEntropy(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
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
