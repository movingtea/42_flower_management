import {
  CommercialState, Prisma, PurchaseState, ReservationState, SupplyState,
} from "../../generated/prisma-v2/client";
import { calculatePurchaseProgress } from "../domain/purchase-progress";
import { assertMaterialQuantity } from "../domain/stock-planning";

export type AllocatePurchaseDemandInput = {
  tenantId: string;
  storeId: string;
  /** Open purchase line receiving the demand attribution. */
  purchaseLineId: string;
  /** Latest-revision requirement of a pending shortage order. */
  requirementId: string;
  /** Desired total allocation for this purchase-line/requirement pair. */
  quantity: number;
  /** Authenticated staff member recorded on the attribution audit event. */
  actorStaffId: string;
};

export type AllocatePurchaseDemandResult = {
  allocationId: string | null;
  changed: boolean;
  orderId: string;
  requirementId: string;
  purchaseLineId: string;
  purchaseOrderNumber: string;
  materialId: string;
  baseUnit: string;
  /** Allocation stored on this pair after the call. */
  allocatedQty: number;
  requirement: {
    plannedQty: number;
    reservedQty: number;
    currentShortage: number;
    /** Sum of all purchase allocations on this requirement after the call. */
    allocatedQty: number;
    /** Current shortage not yet attributed to any purchase line. */
    remainingShortage: number;
  };
  purchaseLine: {
    expectedBaseQty: number;
    /** Accepted-original plus downgraded quantity already received on this line. */
    receivedQty: number;
    acceptedOriginalQty: number;
    downgradedQty: number;
    rejectedQty: number;
    /** Accepted, downgraded and rejected quantity. */
    processedQty: number;
    /** Expected base quantity not yet processed by any disposition. */
    outstandingQty: number;
    /** Sum of all demand allocations on this purchase line after the call. */
    allocatedQty: number;
    /** Outstanding unprocessed quantity still available for new attribution. */
    remainingQty: number;
  };
};

const EPSILON = 1e-8;

function quantity(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

function quantityError(): Error {
  return new Error("分配数量必须符合物料计量精度");
}

/**
 * Attributes a positive quantity of one latest-revision shortage requirement to one open
 * purchase line.
 *
 * PurchaseDemandAllocation is procurement attribution only: it neither reserves nor consumes
 * inventory, and it does not promise inbound supply. FutureSupplyAllocation is intentionally
 * not written here because that model represents a supplier-confirmed in-transit promise;
 * this flow only links demand to an already-open purchase line and leaves order supply state
 * unchanged until a receipt-driven recheck can actually reserve stock.
 *
 * The quantity is the desired total for the pair, so an exact retry is a no-op. Increasing a
 * repeated allocation is allowed only while both the requirement's latest current shortage and
 * the purchase line's outstanding unreceived quantity still have room.
 */
export async function allocatePurchaseDemand(
  tx: Prisma.TransactionClient,
  input: AllocatePurchaseDemandInput,
): Promise<AllocatePurchaseDemandResult> {
  if (!input.tenantId || !input.storeId) throw new Error("缺少租户或门店信息");
  const actorStaffId = input.actorStaffId?.trim();
  if (!actorStaffId) throw new Error("缺少操作员工信息");

  // These reads only locate rows for the stable lock order; all validation is repeated after
  // the locks below, so ownership and revision decisions never rely on this pre-lock snapshot.
  const requirementRef = await tx.orderMaterialRequirement.findUnique({
    where: { id: input.requirementId },
    select: { orderItem: { select: { orderId: true } } },
  });
  const lineRef = await tx.purchaseOrderLine.findUnique({
    where: { id: input.purchaseLineId },
    select: { purchaseOrderId: true },
  });
  if (!requirementRef) throw new Error("物料需求不存在或不属于当前门店");
  if (!lineRef) throw new Error("采购明细不存在或不属于当前门店");

  // Match the existing order-first invariant used by confirmation and revision: every writer
  // locks the order before touching its requirements. Stable allocation order is
  // Order -> OrderMaterialRequirement -> PurchaseOrder -> PurchaseOrderLine. Because the order
  // lock is held first, the latest revision cannot change while this transaction validates.
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${requirementRef.orderItem.orderId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "OrderMaterialRequirement" WHERE id = ${input.requirementId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${lineRef.purchaseOrderId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "PurchaseOrderLine" WHERE id = ${input.purchaseLineId} FOR UPDATE`;

  const requirement = await tx.orderMaterialRequirement.findUnique({
    where: { id: input.requirementId },
    include: {
      material: true,
      reservations: { where: { state: ReservationState.ACTIVE }, select: { quantity: true } },
      orderItem: {
        include: {
          order: { include: { revisions: { orderBy: { number: "desc" }, take: 1 } } },
        },
      },
    },
  });
  const line = await tx.purchaseOrderLine.findUnique({
    where: { id: input.purchaseLineId },
    include: { material: true, purchaseOrder: true },
  });
  const existing = await tx.purchaseDemandAllocation.findUnique({
    where: {
      purchaseLineId_requirementId: {
        purchaseLineId: input.purchaseLineId,
        requirementId: input.requirementId,
      },
    },
  });
  const requirementTotals = await tx.purchaseDemandAllocation.aggregate({
    where: { requirementId: input.requirementId },
    _sum: { allocatedQty: true },
  });
  const lineTotals = await tx.purchaseDemandAllocation.aggregate({
    where: { purchaseLineId: input.purchaseLineId },
    _sum: { allocatedQty: true },
  });
  const processedReceipts = await tx.goodsReceiptLine.findMany({
    where: { purchaseLineId: input.purchaseLineId },
    select: { disposition: true, quantity: true },
  });
  const processedRows = processedReceipts.map((row) => ({
    disposition: row.disposition,
    quantity: quantity(row.quantity),
  }));
  if (!requirement) throw new Error("物料需求不存在或不属于当前门店");
  if (!line) throw new Error("采购明细不存在或不属于当前门店");

  const { order } = requirement.orderItem;
  if (order.tenantId !== input.tenantId || order.storeId !== input.storeId ||
      line.purchaseOrder.tenantId !== input.tenantId || line.purchaseOrder.storeId !== input.storeId ||
      requirement.material.tenantId !== input.tenantId || line.material.tenantId !== input.tenantId) {
    throw new Error("物料需求或采购明细不属于当前门店");
  }
  if (line.materialId !== requirement.materialId) {
    throw new Error("采购明细与物料需求不是同一物料");
  }
  if (line.purchaseOrder.state !== PurchaseState.ORDERED &&
      line.purchaseOrder.state !== PurchaseState.PARTIALLY_RECEIVED) {
    throw new Error("采购单已关闭，不能继续分配");
  }
  if (order.commercialState !== CommercialState.PENDING_CONFIRMATION ||
      order.supplyState !== SupplyState.PURCHASE_REQUIRED) {
    throw new Error("订单当前没有待采购的缺料需求");
  }
  const latestRevision = order.revisions[0];
  if (!latestRevision || requirement.revisionId !== latestRevision.id) {
    throw new Error("只能分配订单最新版的物料需求");
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("分配数量必须大于零");
  }
  try {
    assertMaterialQuantity(input.quantity, requirement.material.quantityScale);
  } catch {
    throw quantityError();
  }
  if (line.purchaseOrder.expectedAt &&
      line.purchaseOrder.expectedAt.getTime() > requirement.needBy.getTime()) {
    throw new Error("采购单预计到货时间晚于需求最晚时间");
  }

  const expectedBaseQty = line.expectedBaseQty !== null
    ? quantity(line.expectedBaseQty)
    : line.purchaseUnit === line.material.baseUnit
      ? quantity(line.orderedQty)
      : null;
  if (expectedBaseQty === null || !Number.isFinite(expectedBaseQty) || expectedBaseQty <= 0) {
    throw new Error("采购明细缺少有效的基础单位数量");
  }
  const progress = calculatePurchaseProgress(expectedBaseQty, processedRows);

  const reservedQty = requirement.reservations.reduce((sum, row) => sum + quantity(row.quantity), 0);
  const currentShortage = Math.max(0, quantity(requirement.plannedQty) - reservedQty);
  const existingQty = quantity(existing?.allocatedQty);
  if (input.quantity < existingQty - EPSILON) {
    throw new Error(`该采购行对需求已分配 ${existingQty}${requirement.material.baseUnit}，不能减少`);
  }
  const delta = input.quantity - existingQty;
  const changed = delta > EPSILON;
  const requirementAllocatedQty = quantity(requirementTotals._sum.allocatedQty) + (changed ? delta : 0);
  const lineAllocatedQty = quantity(lineTotals._sum.allocatedQty) + (changed ? delta : 0);
  const receivedQty = progress.acceptedOriginalQty + progress.downgradedQty;
  const outstandingQty = progress.remainingQty;
  // An exact retry is an idempotent no-op even if a later receipt reduced the line's remaining
  // outstanding quantity; it must not reserve new capacity or fail capacity validation.
  if (changed) {
    if (requirementAllocatedQty > currentShortage + EPSILON) {
      throw new Error(`分配数量超过需求剩余缺口 ${currentShortage}${requirement.material.baseUnit}`);
    }
    if (lineAllocatedQty > outstandingQty + EPSILON) {
      const available = Math.max(0, outstandingQty - quantity(lineTotals._sum.allocatedQty));
      throw new Error(`分配数量超过采购明细未处理可分配数量 ${available}${requirement.material.baseUnit}`);
    }
  }

  let allocation = existing;
  if (changed) {
    allocation = existing
      ? await tx.purchaseDemandAllocation.update({
          where: { id: existing.id },
          data: { allocatedQty: input.quantity },
        })
      : await tx.purchaseDemandAllocation.create({
          data: {
            purchaseLineId: input.purchaseLineId,
            requirementId: input.requirementId,
            allocatedQty: input.quantity,
          },
        });
    await tx.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        actorStaffId,
        action: "PURCHASE_DEMAND_ALLOCATED",
        entityType: "PurchaseDemandAllocation",
        entityId: allocation.id,
        beforeSnapshot: {
          allocationId: existing?.id ?? null,
          allocatedQty: existingQty,
          requirementId: input.requirementId,
          purchaseLineId: input.purchaseLineId,
          purchaseOrderNumber: line.purchaseOrder.number,
          orderId: order.id,
          materialId: requirement.materialId,
          baseUnit: requirement.material.baseUnit,
        },
        afterSnapshot: {
          allocationId: allocation.id,
          allocatedQty: changed ? input.quantity : existingQty,
          delta,
          requirementId: input.requirementId,
          purchaseLineId: input.purchaseLineId,
          purchaseOrderNumber: line.purchaseOrder.number,
          orderId: order.id,
          materialId: requirement.materialId,
          baseUnit: requirement.material.baseUnit,
          requirementRemainingShortage: Math.max(0, currentShortage - requirementAllocatedQty),
          purchaseLineRemainingQty: Math.max(0, outstandingQty - lineAllocatedQty),
        },
      },
    });
  }

  return {
    allocationId: allocation?.id ?? null,
    changed,
    orderId: order.id,
    requirementId: requirement.id,
    purchaseLineId: line.id,
    purchaseOrderNumber: line.purchaseOrder.number,
    materialId: requirement.materialId,
    baseUnit: requirement.material.baseUnit,
    allocatedQty: changed ? input.quantity : existingQty,
    requirement: {
      plannedQty: quantity(requirement.plannedQty),
      reservedQty,
      currentShortage,
      allocatedQty: requirementAllocatedQty,
      remainingShortage: Math.max(0, currentShortage - requirementAllocatedQty),
    },
    purchaseLine: {
      expectedBaseQty,
      receivedQty,
      acceptedOriginalQty: progress.acceptedOriginalQty,
      downgradedQty: progress.downgradedQty,
      rejectedQty: progress.rejectedQty,
      processedQty: progress.processedQty,
      outstandingQty,
      allocatedQty: lineAllocatedQty,
      remainingQty: Math.max(0, outstandingQty - lineAllocatedQty),
    },
  };
}
