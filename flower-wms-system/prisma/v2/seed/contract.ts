/**
 * E1.4 test-data tiers: canonical names, dependency ordering and `--tiers=` parsing.
 *
 * This module is intentionally free of Prisma, environment or database imports so
 * the seed CLI, the tier checker script and future tooling share one contract
 * without side effects.
 */

/** Canonical application order. Every tier below a tier in this list is a dependency. */
export const SEED_TIERS = [
  "minimum",
  "roles",
  "p1-scenarios",
  "e2e-fixtures",
] as const;

export type SeedTier = (typeof SEED_TIERS)[number];

/**
 * Dependency graph. Applying a tier implies its dependencies:
 * e2e-fixtures contains p1-scenarios, which contains roles, which contains minimum.
 */
export const TIER_DEPENDENCIES: Readonly<Record<SeedTier, readonly SeedTier[]>> = {
  minimum: [],
  roles: ["minimum"],
  "p1-scenarios": ["roles"],
  "e2e-fixtures": ["p1-scenarios"],
};

/** `db:v2:seed:test` and `db:v2:reset:test` keep their historical default data. */
export const DEFAULT_TEST_TIERS: readonly SeedTier[] = ["minimum", "roles"];

export const TIER_FLAG = "--tiers=";

export class SeedTierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedTierError";
  }
}

export function isSeedTier(value: string): value is SeedTier {
  return (SEED_TIERS as readonly string[]).includes(value);
}

/**
 * Parse the value of `--tiers=`. Rejects empty values, unknown names and
 * duplicates instead of silently dropping them.
 */
export function parseTierList(raw: string): SeedTier[] {
  if (typeof raw !== "string") {
    throw new SeedTierError("--tiers 需要以 --tiers=minimum,roles 的形式提供值");
  }
  const entries = raw.split(",");
  const parsed: SeedTier[] = [];
  for (const entry of entries) {
    const name = entry.trim();
    if (name.length === 0) {
      throw new SeedTierError("--tiers 不能包含空值，可选值：" + SEED_TIERS.join(","));
    }
    if (!isSeedTier(name)) {
      throw new SeedTierError(
        `未知的 tier "${name}"，可选值：${SEED_TIERS.join(",")}`,
      );
    }
    if (parsed.includes(name)) {
      throw new SeedTierError(`重复的 tier "${name}"，--tiers 不允许重复`);
    }
    parsed.push(name);
  }
  return parsed;
}

/** Expand requested tiers with their dependencies, then order them canonically. */
export function resolveTierClosure(requested: readonly SeedTier[]): SeedTier[] {
  const included = new Set<SeedTier>();
  const include = (tier: SeedTier): void => {
    if (included.has(tier)) return;
    included.add(tier);
    for (const dependency of TIER_DEPENDENCIES[tier]) include(dependency);
  };
  for (const tier of requested) include(tier);
  return SEED_TIERS.filter((tier) => included.has(tier));
}

export function formatTierList(tiers: readonly SeedTier[]): string {
  return tiers.join(",");
}
