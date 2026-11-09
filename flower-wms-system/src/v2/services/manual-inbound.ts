import { Prisma, TransactionKind } from "../../generated/prisma-v2/client";
import { assertMaterialQuantity } from "../domain/stock-planning";

export async function createManualInbound(tx: Prisma.TransactionClient, input: {
  tenantId: string; storeId: string; actorStaffId: string; materialId: string; locationId: string;
  batchNo: string; quantity: number; unitCost: number; usableUntil?: Date; reason: string; source: string; idempotencyKey: string;
}) {
  const reason = input.reason.trim(); const source = input.source.trim();
  if (!reason || !source) throw new Error("入库来源和原因必填");
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) throw new Error("单位成本不能为负数");
  const material = await tx.material.findFirst({ where: { id: input.materialId, tenantId: input.tenantId, active: true } });
  const location = await tx.inventoryLocation.findFirst({ where: { id: input.locationId, storeId: input.storeId } });
  if (!material || !location) throw new Error("物料或库位不存在，或不属于当前门店");
  assertMaterialQuantity(input.quantity, material.quantityScale);
  if (input.quantity <= 0) throw new Error("入库数量必须大于零");
  await tx.$queryRaw`SELECT id FROM "InventoryLocation" WHERE id = ${location.id} FOR UPDATE`;
  const existing = await tx.inventoryTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing.batchId;
  const batch = await tx.inventoryBatch.create({ data: { storeId: input.storeId, materialId: material.id, batchNo: input.batchNo, usableUntil: input.usableUntil, unitCost: input.unitCost, costEstimated: false } });
  await tx.batchBalance.create({ data: { batchId: batch.id, locationId: location.id, onHandQty: input.quantity } });
  await tx.inventoryTransaction.create({ data: { batchId: batch.id, kind: TransactionKind.INBOUND, quantity: input.quantity, toLocationId: location.id, referenceType: "MANUAL_INBOUND", referenceId: batch.id, idempotencyKey: input.idempotencyKey } });
  await tx.auditEvent.create({ data: { tenantId: input.tenantId, storeId: input.storeId, actorStaffId: input.actorStaffId, action: "MANUAL_INBOUND_CREATED", entityType: "InventoryBatch", entityId: batch.id, afterSnapshot: { materialId: material.id, batchNo: batch.batchNo, quantity: input.quantity, unit: material.baseUnit, unitCost: input.unitCost, source, reason, locationId: location.id } } });
  return batch.id;
}
