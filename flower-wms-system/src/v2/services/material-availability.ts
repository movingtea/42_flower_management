import { Prisma, ReservationState } from "../../generated/prisma-v2/client";
import { summarizeMaterialAvailability } from "../domain/material-availability";

type AvailabilityDb = Pick<
  Prisma.TransactionClient,
  "material" | "inventoryBatch" | "inventoryReservation" | "sampleInventoryReservation"
>;

export type MaterialAvailability = {
  materialId: string;
  baseUnit: string;
  quantityScale: number;
  onHandQty: number;
  frozenQty: number;
  orderReservedQty: number;
  sampleReservedQty: number;
  /** On hand minus frozen and active order/sample reservations, clamped per batch at zero. */
  availableQty: number;
};

export type MaterialAvailabilityQuery = {
  tenantId: string;
  storeId: string;
  materialIds: readonly string[];
  /** When set, only batches usable at this time participate, matching reservation behavior. */
  needBy?: Date;
};

function quantity(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

/**
 * Reads the current V2 availability model for a set of tenant-owned materials in one store.
 *
 * This is a read-only snapshot for display and an early server-side check. Callers that mutate
 * reservations must still rely on the row locks and availability recheck inside
 * reserveOrderMaterial before committing.
 */
export async function getMaterialAvailableQuantities(
  db: AvailabilityDb,
  input: MaterialAvailabilityQuery,
): Promise<Map<string, MaterialAvailability>> {
  if (!input.tenantId || !input.storeId) throw new Error("缺少租户或门店信息");
  if (input.needBy && !Number.isFinite(input.needBy.getTime())) throw new Error("需求最晚时间无效");

  const materialIds = [...new Set(input.materialIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (materialIds.length === 0) return new Map();

  const materials = await db.material.findMany({
    where: { id: { in: materialIds }, tenantId: input.tenantId },
    select: { id: true, baseUnit: true, quantityScale: true },
  });
  if (materials.length === 0) return new Map();

  const batches = await db.inventoryBatch.findMany({
    where: {
      storeId: input.storeId,
      materialId: { in: materials.map((material) => material.id) },
      ...(input.needBy
        ? { OR: [{ usableUntil: null }, { usableUntil: { gte: input.needBy } }] }
        : {}),
    },
    select: {
      id: true,
      materialId: true,
      balances: { select: { onHandQty: true, frozenQty: true } },
    },
    orderBy: { id: "asc" },
  });
  const batchIds = batches.map((batch) => batch.id);

  const [orderReservations, sampleReservations] = batchIds.length === 0
    ? [[], []]
    : await Promise.all([
        db.inventoryReservation.groupBy({
          by: ["batchId"],
          where: { batchId: { in: batchIds }, state: ReservationState.ACTIVE },
          _sum: { quantity: true },
        }),
        db.sampleInventoryReservation.groupBy({
          by: ["batchId"],
          where: { batchId: { in: batchIds }, state: ReservationState.ACTIVE },
          _sum: { quantity: true },
        }),
      ]);
  const orderReservedByBatch = new Map(
    orderReservations.map((row) => [row.batchId, quantity(row._sum.quantity)]),
  );
  const sampleReservedByBatch = new Map(
    sampleReservations.map((row) => [row.batchId, quantity(row._sum.quantity)]),
  );

  const result = new Map<string, MaterialAvailability>();
  for (const material of materials) {
    const materialBatches = batches.filter((batch) => batch.materialId === material.id);
    const totals = summarizeMaterialAvailability(materialBatches.map((batch) => ({
      onHand: batch.balances.reduce((sum, balance) => sum + quantity(balance.onHandQty), 0),
      frozen: batch.balances.reduce((sum, balance) => sum + quantity(balance.frozenQty), 0),
      orderReserved: orderReservedByBatch.get(batch.id) ?? 0,
      sampleReserved: sampleReservedByBatch.get(batch.id) ?? 0,
    })));
    result.set(material.id, {
      materialId: material.id,
      baseUnit: material.baseUnit,
      quantityScale: material.quantityScale,
      ...totals,
    });
  }
  return result;
}
