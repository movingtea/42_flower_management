import { describe, expect, it } from "vitest";
import {
  allocateBatches,
  assertMaterialQuantity,
  availableQuantity,
  expandRecipe,
  type AvailableBatch,
} from "./stock-planning";

const needBy = new Date("2026-12-10T10:00:00Z");

function batch(overrides: Partial<AvailableBatch> = {}): AvailableBatch {
  return {
    batchId: "batch-1",
    materialId: "rose-a-red",
    onHand: 10,
    frozen: 0,
    orderReserved: 0,
    sampleReserved: 0,
    usableUntil: null,
    receivedAt: new Date("2026-12-01T00:00:00Z"),
    ...overrides,
  };
}

describe("availableQuantity", () => {
  it("subtracts frozen, order-reserved and sample-reserved stock", () => {
    expect(availableQuantity(batch({ frozen: 3 }))).toBe(7);
    expect(availableQuantity(batch({ orderReserved: 4, sampleReserved: 2 }))).toBe(4);
    expect(availableQuantity(batch({ frozen: 1, orderReserved: 2, sampleReserved: 3 }))).toBe(4);
  });

  it("clamps fully committed stock to zero instead of going negative", () => {
    expect(availableQuantity(batch({ onHand: 2, frozen: 1, orderReserved: 3 }))).toBe(0);
  });

  it("rejects negative quantity inputs", () => {
    expect(() => availableQuantity(batch({ frozen: -1 }))).toThrow(/nonnegative/);
  });
});

describe("allocateBatches", () => {
  it("never allocates frozen stock and reports the remaining shortage", () => {
    const result = allocateBatches(
      { materialId: "rose-a-red", quantity: 8, needBy },
      [batch({ batchId: "partially-frozen", onHand: 10, frozen: 6 })],
    );

    expect(result).toEqual({
      allocations: [{ batchId: "partially-frozen", quantity: 4 }],
      shortage: 4,
    });
  });

  it("allocates dated batches FEFO, then undated batches FIFO", () => {
    const result = allocateBatches(
      { materialId: "rose-a-red", quantity: 8, needBy },
      [
        batch({
          batchId: "later-expiry",
          onHand: 5,
          usableUntil: new Date("2026-12-20T00:00:00Z"),
          receivedAt: new Date("2026-11-20T00:00:00Z"),
        }),
        batch({
          batchId: "unknown-new",
          onHand: 1,
          usableUntil: null,
          receivedAt: new Date("2026-12-05T00:00:00Z"),
        }),
        batch({
          batchId: "soon-expiry",
          onHand: 2,
          usableUntil: new Date("2026-12-11T00:00:00Z"),
          receivedAt: new Date("2026-12-02T00:00:00Z"),
        }),
        batch({
          batchId: "unknown-old",
          onHand: 1,
          usableUntil: null,
          receivedAt: new Date("2026-11-18T00:00:00Z"),
        }),
      ],
    );

    expect(result).toEqual({
      allocations: [
        { batchId: "soon-expiry", quantity: 2 },
        { batchId: "later-expiry", quantity: 5 },
        { batchId: "unknown-old", quantity: 1 },
      ],
      shortage: 0,
    });
  });

  it("skips expired batches and batches for another material", () => {
    const result = allocateBatches(
      { materialId: "rose-a-red", quantity: 3, needBy },
      [
        batch({
          batchId: "expired",
          onHand: 10,
          usableUntil: new Date("2026-12-09T23:59:59Z"),
        }),
        batch({ batchId: "wrong-material", materialId: "rose-b-red", onHand: 10 }),
        batch({ batchId: "eligible", onHand: 3 }),
      ],
    );

    expect(result).toEqual({
      allocations: [{ batchId: "eligible", quantity: 3 }],
      shortage: 0,
    });
  });

  it("returns the full requested quantity as shortage when nothing is eligible", () => {
    expect(allocateBatches({ materialId: "rose-a-red", quantity: 9, needBy }, [])).toEqual({
      allocations: [],
      shortage: 9,
    });
  });
});

describe("expandRecipe", () => {
  it("rounds expected loss up at the material quantity scale and merges duplicate lines", () => {
    const requirements = expandRecipe(
      [
        {
          materialId: "rose-a-red",
          perUnitQuantity: 0.25,
          expectedLossRate: 0.2,
          reservePerOrder: true,
          quantityScale: 2,
        },
        {
          materialId: "rose-a-red",
          perUnitQuantity: 0.05,
          expectedLossRate: 0,
          reservePerOrder: true,
          quantityScale: 2,
        },
        {
          materialId: "ribbon-roll",
          perUnitQuantity: 1,
          expectedLossRate: 0,
          reservePerOrder: false,
          quantityScale: 0,
        },
      ],
      3,
      needBy,
    );

    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({ materialId: "rose-a-red", needBy });
    expect(requirements[0].quantity).toBeCloseTo(1.09, 10);
  });

  it("rejects quantities that do not fit the material base unit", () => {
    expect(() => assertMaterialQuantity(0.5, 0)).toThrow(/base unit/);
    expect(() => assertMaterialQuantity(0.5, 1)).not.toThrow();
    expect(() => assertMaterialQuantity(0.5, 4)).toThrow(/quantity scale/);
  });

  it("rejects an expected loss rate outside [0, 1)", () => {
    expect(() =>
      expandRecipe(
        [
          {
            materialId: "rose-a-red",
            perUnitQuantity: 1,
            expectedLossRate: Number.NaN,
            reservePerOrder: true,
            quantityScale: 0,
          },
        ],
        1,
        needBy,
      ),
    ).toThrow(/Expected loss rate/);
  });
});
