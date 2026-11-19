import {
  LocationKind,
  Prisma,
  ReservationState,
  SamplePlanState,
} from "../../generated/prisma-v2/client";
import { allocateBatches, assertMaterialQuantity } from "../domain/stock-planning";

/**
 * Confirmed customer orders outrank sample plans that have been approved but
 * not started. Release just enough active sample reservations from those plans
 * to cover the order shortage, and leave an audit marker for the sample plan.
 *
 * The caller already holds the candidate batch row locks, so no plan row lock is
 * taken here. This avoids a plan -> batch / batch -> plan lock-order inversion
 * with sample approval.
 */
async function releaseUnstartedSampleReservations(
  tx: Prisma.TransactionClient,
  requirement: {
    materialId: string;
    orderItem: { order: { id: string; tenantId: string; storeId: string } };
  },
  batchIds: readonly string[],
  neededQty: number,
): Promise<number> {
  if (neededQty <= 0 || batchIds.length === 0) return 0;
  const reservations = await tx.sampleInventoryReservation.findMany({
    where: {
      batchId: { in: [...batchIds] },
      state: ReservationState.ACTIVE,
      execution: {
        startedAt: null,
        cancelledAt: null,
        plan: { state: SamplePlanState.APPROVED },
      },
    },
    include: {
      execution: {
        include: {
          plan: { select: { id: true, tenantId: true, storeId: true, name: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  const affected = new Map<string, { planId: string; tenantId: string; storeId: string; name: string; quantity: number }>();
  let released = 0;
  for (const reservation of reservations) {
    if (released >= neededQty - 1e-8) break;
    const quantity = Number(reservation.quantity);
    await tx.sampleInventoryReservation.update({
      where: { id: reservation.id },
      data: { state: ReservationState.RELEASED },
    });
    const plan = reservation.execution.plan;
    const current = affected.get(plan.id) ?? {
      planId: plan.id,
      tenantId: plan.tenantId,
      storeId: plan.storeId,
      name: plan.name,
      quantity: 0,
    };
    current.quantity += quantity;
    affected.set(plan.id, current);
    released += quantity;
  }
  for (const plan of affected.values()) {
    await tx.auditEvent.create({
      data: {
        tenantId: plan.tenantId,
        storeId: plan.storeId,
        actorStaffId: null,
        action: "SAMPLE_PLAN_AT_RISK",
        entityType: "SamplePlan",
        entityId: plan.planId,
        afterSnapshot: {
          reason: "CUSTOMER_ORDER_PRIORITY",
          orderId: requirement.orderItem.order.id,
          materialId: requirement.materialId,
          releasedQty: plan.quantity,
          planName: plan.name,
        },
      },
    });
  }
  return released;
}

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
  const batches = await tx.inventoryBatch.findMany({
    where: { id: { in: ids } },
    include: { balances: { include: { location: { select: { kind: true } } } } },
  });
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
  let sampleByBatch = new Map(sampleReservations.map((row) => [row.batchId, Number(row._sum.quantity ?? 0)]));
  const allocate = () => allocateBatches(
    { materialId: requirement.materialId, quantity: requested - existingQuantity, needBy: requirement.needBy },
    batches.map((batch) => ({
      batchId: batch.id,
      materialId: batch.materialId,
      onHand: batch.balances
        .filter((balance) => balance.location.kind === LocationKind.WAREHOUSE)
        .reduce((sum, balance) => sum + Number(balance.onHandQty), 0),
      frozen: batch.balances
        .filter((balance) => balance.location.kind === LocationKind.WAREHOUSE)
        .reduce((sum, balance) => sum + Number(balance.frozenQty), 0),
      orderReserved: orderByBatch.get(batch.id) ?? 0,
      sampleReserved: sampleByBatch.get(batch.id) ?? 0,
      usableUntil: batch.usableUntil,
      receivedAt: batch.receivedAt,
    })),
  );
  let allocation = allocate();
  if (allocation.shortage > 1e-8) {
    const released = await releaseUnstartedSampleReservations(
      tx,
      requirement,
      ids,
      allocation.shortage,
    );
    if (released > 1e-8) {
      // The released rows are already committed in this transaction; refresh the
      // per-batch sample reservation view before allocating the order again.
      const refreshedSampleReservations = await tx.sampleInventoryReservation.groupBy({
        by: ["batchId"],
        where: { batchId: { in: ids }, state: ReservationState.ACTIVE },
        _sum: { quantity: true },
      });
      sampleByBatch = new Map(refreshedSampleReservations.map((row) => [row.batchId, Number(row._sum.quantity ?? 0)]));
      allocation = allocate();
    }
  }
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
