import { randomBytes } from "node:crypto";

/**
 * Unique run marker. Every spec that creates data embeds it in codes/names so
 * repeated runs against a fresh isolated database never collide and assertions
 * can always find exactly the rows this run created.
 *
 * The marker is kept short because material/supplier codes are limited to
 * 32 upper-case characters and derive suffixes such as `-ROSE`.
 */
export function createMarker(scope: string): string {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  return `E2E-${scope}-${stamp}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

/** Longer, human-readable value derived from a marker (used where names need spaces). */
export function markerLabel(marker: string): string {
  return `浏览器验收 ${marker}`;
}
