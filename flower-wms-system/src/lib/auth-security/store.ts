/**
 * Bounded in-memory failure store for the Sprint E3.6 login throttle.
 *
 * - Bounded: at most `maxEntries` keys; the oldest key is evicted when a new one
 *   would exceed the cap, and expired entries are swept opportunistically.
 * - TTL: entries older than `ttlMs` (no lock, window long gone) are dropped.
 * - Injectable clock so window/lock recovery is testable without sleeping.
 *
 * This is a single-instance implementation only (see docs): multi-instance
 * production needs a shared store, which is a blocking open decision.
 */

export type ThrottleBucket = {
  failures: number;
  windowStartMs: number;
  /** 0 means "not locked". */
  lockedUntilMs: number;
};

export type ThrottleStateStore = {
  get(key: string): ThrottleBucket | undefined;
  set(key: string, bucket: ThrottleBucket): void;
  delete(key: string): void;
  size(): number;
};

export type MemoryThrottleStoreOptions = {
  maxEntries: number;
  ttlMs: number;
  clock: () => number;
};

export function createMemoryThrottleStore(
  options: MemoryThrottleStoreOptions,
): ThrottleStateStore {
  const { maxEntries, ttlMs, clock } = options;
  const entries = new Map<string, ThrottleBucket>();

  function isExpired(bucket: ThrottleBucket, nowMs: number): boolean {
    // An entry stays relevant until the newer of its failure window and lock end.
    const lastRelevantMs = Math.max(bucket.windowStartMs, bucket.lockedUntilMs);
    return nowMs - lastRelevantMs > ttlMs;
  }

  function sweep(nowMs: number): void {
    for (const [key, bucket] of entries) {
      if (isExpired(bucket, nowMs)) entries.delete(key);
    }
  }

  return {
    get(key) {
      return entries.get(key);
    },
    set(key, bucket) {
      if (!entries.has(key) && entries.size >= maxEntries) {
        sweep(clock());
        // Still full: evict the oldest key so the store can never grow past the cap.
        while (entries.size >= maxEntries) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) break;
          entries.delete(oldest);
        }
      }
      // Re-insert so Map iteration order tracks recency for eviction.
      entries.delete(key);
      entries.set(key, bucket);
    },
    delete(key) {
      entries.delete(key);
    },
    size() {
      return entries.size;
    },
  };
}
