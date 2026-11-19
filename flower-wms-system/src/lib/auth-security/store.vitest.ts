import { describe, expect, it } from "vitest";
import { createMemoryThrottleStore } from "./store";

function setup(options: { maxEntries?: number; ttlMs?: number } = {}) {
  let now = 1_000_000;
  const clock = () => now;
  const store = createMemoryThrottleStore({
    maxEntries: options.maxEntries ?? 3,
    ttlMs: options.ttlMs ?? 60_000,
    clock,
  });
  return {
    store,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("memory throttle store", () => {
  it("stores and deletes buckets", () => {
    const { store } = setup();
    const bucket = { failures: 1, windowStartMs: 1_000_000, lockedUntilMs: 0 };
    store.set("account:a", bucket);
    expect(store.get("account:a")).toEqual(bucket);
    expect(store.size()).toBe(1);
    store.delete("account:a");
    expect(store.get("account:a")).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it("never grows past maxEntries and evicts the oldest key", () => {
    const { store } = setup({ maxEntries: 2 });
    const bucket = (failures: number) => ({ failures, windowStartMs: 1_000_000, lockedUntilMs: 0 });
    store.set("account:a", bucket(1));
    store.set("account:b", bucket(2));
    store.set("account:c", bucket(3));
    expect(store.size()).toBe(2);
    expect(store.get("account:a")).toBeUndefined();
    expect(store.get("account:b")).toEqual(bucket(2));
    expect(store.get("account:c")).toEqual(bucket(3));
    // Re-inserting an existing key refreshes it instead of evicting.
    store.set("account:b", bucket(9));
    expect(store.get("account:b")).toEqual(bucket(9));
    expect(store.size()).toBe(2);
  });

  it("sweeps expired entries when the cap is reached", () => {
    const { store, advance } = setup({ maxEntries: 2, ttlMs: 1_000 });
    store.set("account:a", { failures: 1, windowStartMs: 1_000_000, lockedUntilMs: 0 });
    store.set("account:b", { failures: 1, windowStartMs: 1_000_001, lockedUntilMs: 0 });
    advance(5_000);
    store.set("account:c", { failures: 1, windowStartMs: 1_005_000, lockedUntilMs: 0 });
    expect(store.size()).toBe(1);
    expect(store.get("account:c")).toBeDefined();
  });

  it("keeps a still-locked entry alive during the sweep", () => {
    const { store, advance } = setup({ maxEntries: 2, ttlMs: 1_000 });
    store.set("account:a", { failures: 5, windowStartMs: 1_000_000, lockedUntilMs: 1_010_000 });
    store.set("account:b", { failures: 1, windowStartMs: 1_000_001, lockedUntilMs: 0 });
    advance(5_000);
    store.set("account:c", { failures: 1, windowStartMs: 1_005_000, lockedUntilMs: 0 });
    expect(store.get("account:a")).toBeDefined();
    expect(store.get("account:b")).toBeUndefined();
  });
});
