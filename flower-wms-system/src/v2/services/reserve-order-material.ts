import { Prisma, ReservationState } from "../../generated/prisma-v2/client";
import { allocateBatches, assertMaterialQuantity } from "../domain/stock-planning";

/** Called inside the transaction that confirms an order. Batch locks serialize order and sample reservations. */
export async function reserveOrderMaterial(
  tx: Prisma.TransactionClient,
  requirementId: string,
): Promise<{ reserved: number; shortage: number }> {
  const requirement = await tx.orderMaterialRequirement.findUnique({
    where: { id: requirementId },
    include: { material: true, orderItem: { include: { order: true } } },
  });
  if (!requirement) throw new Error("Material requirement not found");
  const { order } = requirement.orderItem;
  if (requirement.material.tenantId !== order.tenantId) {
    throw new Error("Requirement material belongs to another tenant");
  }
  const requested = Number(requirement.plannedQty);
  assertMaterialQuantity(requested, requirement.material.quantityScale);
  if (requested <= 0) throw new Error("Material requirement must be positive");

  // Lock every candidate batch in a stable order. Other inventory writers must use the same lock.
  const candidates = await tx.inventoryBatch.findMany({
    where: {
      storeId: order.storeId,
      materialId: requirement.materialId,
      OR: [{ usableUntil: null }, { usableUntil: { gte: requirement.needBy } }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const candidate of candidates) {
    await tx.$queryRaw`SELECT id FROM "InventoryBatch" WHERE id = ${candidate.id} FOR UPDATE`;
  }
  const ids = candidates.map(({ id }) => id);
  const batches = await tx.inventoryBatch.findMany({ where: { id: { in: ids } }, include: { balances: true } });
  const orderReservations = await tx.inventoryReservation.groupBy({
      by: ["batchId"],
      where: { batchId: { in: ids }, state: ReservationState.ACTIVE },
      _sum: { quantity: true },
    });
  const sampleReservations = await tx.sampleInventoryReservation.groupBy({
      by: ["batchId"],
      where: { batchId: { in: ids }, state: ReservationState.ACTIVE },
      _sum: { quantity: true },
    });
  const existing = await tx.inventoryReservation.findMany({ where: { requirementId, state: ReservationState.ACTIVE } });
  const existingQuantity = existing.reduce((sum, row) => sum + Number(row.quantity), 0);
  if (existingQuantity > requested + 1e-8) throw new Error("Requirement is over-reserved");
  const orderByBatch = new Map(orderReservations.map((row) => [row.batchId, Number(row._sum.quantity ?? 0)]));
  const sampleByBatch = new Map(sampleReservations.map((row) => [row.batchId, Number(row._sum.quantity ?? 0)]));
  const allocation = allocateBatches(
    { materialId: requirement.materialId, quantity: requested - existingQuantity, needBy: requirement.needBy },
    batches.map((batch) => ({
      batchId: batch.id,
      materialId: batch.materialId,
      onHand: batch.balances.reduce((sum, balance) => sum + Number(balance.onHandQty), 0),
      frozen: batch.balances.reduce((sum, balance) => sum + Number(balance.frozenQty), 0),
      orderReserved: orderByBatch.get(batch.id) ?? 0,
      sampleReserved: sampleByBatch.get(batch.id) ?? 0,
      usableUntil: batch.usableUntil,
      receivedAt: batch.receivedAt,
    })),
  );
  for (const item of allocation.allocations) {
    assertMaterialQuantity(item.quantity, requirement.material.quantityScale);
    await tx.inventoryReservation.create({
      data: { requirementId, batchId: item.batchId, quantity: item.quantity },
    });
  }
  return {
    reserved: allocation.allocations.reduce((sum, item) => sum + item.quantity, 0),
    shortage: allocation.shortage,
  };
}
