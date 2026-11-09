import { createHash } from "node:crypto";
import {
  Prisma, PurchaseLineRelationKind, PurchaseState, ReceiptDisposition, ReservationState,
} from "../../generated/prisma-v2/client";
import { assertMaterialQuantity } from "../domain/stock-planning";
import { allocatePurchaseDemand } from "./allocate-purchase-demand";

export type PurchaseDraftLine = { materialId: string; quantity: number; unitPrice: number };
export type PurchaseDraftInput = {
  supplierId: string; expectedAt?: Date; freightCost: number; packagingCost: number;
  otherCost: number; notes?: string | null; lines: PurchaseDraftLine[];
};
type Scope = { tenantId: string; storeId: string; actorStaffId: string };

function money(value: number, label: string) { if (!Number.isFinite(value) || value < 0) throw new Error(`${label}不能为负数`); return value; }
function validateText(value: string | null | undefined, max: number, label: string) { const text = value?.trim() ?? ""; if (text.length > max) throw new Error(`${label}不能超过 ${max} 个字符`); return text || null; }

async function validateDraft(tx: Prisma.TransactionClient, scope: Scope, input: PurchaseDraftInput) {
  if (input.lines.length < 1 || input.lines.length > 50) throw new Error("采购单需包含 1–50 条明细");
  const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, tenantId: scope.tenantId, active: true } });
  if (!supplier) throw new Error("供应商不存在、已停用或不属于当前租户");
  const uniqueIds = [...new Set(input.lines.map((line) => line.materialId))];
  if (uniqueIds.length !== input.lines.length) throw new Error("同一物料不能重复添加，请合并数量");
  const materials = await tx.material.findMany({ where: { id: { in: uniqueIds }, tenantId: scope.tenantId, active: true } });
  if (materials.length !== uniqueIds.length) throw new Error("采购明细包含不存在或已停用的物料");
  const lines = input.lines.map((line) => { const material = materials.find((item) => item.id === line.materialId)!; assertMaterialQuantity(line.quantity, material.quantityScale); if (line.quantity <= 0) throw new Error(`${material.name} 的采购数量必须大于零`); return { materialId: material.id, orderedQty: line.quantity, purchaseUnit: material.baseUnit, expectedBaseQty: line.quantity, unitPrice: money(line.unitPrice, `${material.name} 的采购单价`) }; });
  return { supplier, lines, freightCost: money(input.freightCost, "运费"), packagingCost: money(input.packagingCost, "包装费"), otherCost: money(input.otherCost, "其他费用"), notes: validateText(input.notes, 500, "备注") };
}

export function purchaseDraftTotal(lines: readonly { quantity: number; unitPrice: number }[], fees: { freightCost: number; packagingCost: number; otherCost: number }) { return lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) + fees.freightCost + fees.packagingCost + fees.otherCost; }

export async function createPurchaseDraft(tx: Prisma.TransactionClient, scope: Scope, number: string, input: PurchaseDraftInput) {
  const data = await validateDraft(tx, scope, input);
  const order = await tx.purchaseOrder.create({ data: { tenantId: scope.tenantId, storeId: scope.storeId, supplierId: data.supplier.id, number, state: PurchaseState.DRAFT, expectedAt: input.expectedAt, freightCost: data.freightCost, packagingCost: data.packagingCost, otherCost: data.otherCost, notes: data.notes, lines: { create: data.lines } }, include: { lines: true } });
  await tx.auditEvent.create({ data: { tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId, action: "PURCHASE_DRAFT_CREATED", entityType: "PurchaseOrder", entityId: order.id, afterSnapshot: { number: order.number, supplierId: order.supplierId, state: order.state, lineCount: order.lines.length, total: purchaseDraftTotal(input.lines, data) } } });
  return order;
}

export async function updatePurchaseDraft(tx: Prisma.TransactionClient, scope: Scope, purchaseOrderId: string, input: PurchaseDraftInput) {
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${purchaseOrderId} FOR UPDATE`;
  const current = await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId, tenantId: scope.tenantId, storeId: scope.storeId }, include: { lines: { include: { receiptLines: { select: { id: true } }, allocations: { select: { id: true } } } } } });
  if (!current) throw new Error("采购单不存在或不属于当前门店");
  if (current.state !== PurchaseState.DRAFT) throw new Error("只有草稿采购单可以编辑");
  if (current.lines.some((line) => line.receiptLines.length || line.allocations.length)) throw new Error("已有验收或缺料关联的采购单不能重写明细");
  const data = await validateDraft(tx, scope, input);
  await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId } });
  const order = await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { supplierId: data.supplier.id, expectedAt: input.expectedAt, freightCost: data.freightCost, packagingCost: data.packagingCost, otherCost: data.otherCost, notes: data.notes, lines: { create: data.lines } }, include: { lines: true } });
  await tx.auditEvent.create({ data: { tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId, action: "PURCHASE_DRAFT_UPDATED", entityType: "PurchaseOrder", entityId: order.id, beforeSnapshot: { supplierId: current.supplierId, lineCount: current.lines.length }, afterSnapshot: { supplierId: order.supplierId, lineCount: order.lines.length, total: purchaseDraftTotal(input.lines, data) } } });
  return order;
}

export async function submitPurchaseOrder(tx: Prisma.TransactionClient, scope: Scope, purchaseOrderId: string) {
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${purchaseOrderId} FOR UPDATE`;
  const current = await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId, tenantId: scope.tenantId, storeId: scope.storeId }, include: { lines: true, supplier: true } });
  if (!current) throw new Error("采购单不存在或不属于当前门店"); if (current.state !== PurchaseState.DRAFT) throw new Error("只有草稿采购单可以下单"); if (!current.supplier.active) throw new Error("供应商已停用，不能下单"); if (!current.lines.length) throw new Error("采购单没有明细");
  const order = await tx.purchaseOrder.update({ where: { id: current.id }, data: { state: PurchaseState.ORDERED, orderedAt: new Date() } });
  await tx.auditEvent.create({ data: { tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId, action: "PURCHASE_ORDER_SUBMITTED", entityType: "PurchaseOrder", entityId: order.id, beforeSnapshot: { state: current.state }, afterSnapshot: { state: order.state, orderedAt: order.orderedAt } } }); return order;
}

export async function cancelPurchaseOrder(tx: Prisma.TransactionClient, scope: Scope, purchaseOrderId: string, reason: string) {
  const cleanReason = reason.trim(); if (!cleanReason) throw new Error("取消原因必填");
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${purchaseOrderId} FOR UPDATE`;
  const current = await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId, tenantId: scope.tenantId, storeId: scope.storeId }, include: { lines: { include: { receiptLines: { select: { id: true } }, allocations: { select: { id: true } } } } } });
  if (!current) throw new Error("采购单不存在或不属于当前门店"); if (current.state !== PurchaseState.DRAFT && current.state !== PurchaseState.ORDERED) throw new Error("当前采购单不能取消"); if (current.lines.some((line) => line.receiptLines.length)) throw new Error("已有验收记录的采购单不能取消"); if (current.lines.some((line) => line.allocations.length)) throw new Error("已关联订单缺料的采购单需先解除或重建补货关系，不能直接取消");
  const order = await tx.purchaseOrder.update({ where: { id: current.id }, data: { state: PurchaseState.CANCELLED, cancelledAt: new Date(), cancellationReason: cleanReason } });
  await tx.auditEvent.create({ data: { tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId, action: "PURCHASE_ORDER_CANCELLED", entityType: "PurchaseOrder", entityId: order.id, beforeSnapshot: { state: current.state }, afterSnapshot: { state: order.state, cancellationReason: cleanReason } } }); return order;
}

export type PurchaseSupplementInput = {
  sourceLineId: string;
  kind: "EXTRA_ORDER" | "REPLACEMENT_DELIVERY";
  quantity: number;
  unitPrice?: number;
  relationKey: string;
};

/**
 * Appends a separately capped line for extra goods or a supplier re-delivery. The original line
 * and all of its receipt/rejection history remain immutable. Re-delivery capacity is derived from
 * rejected quantity that is not already fulfilled or still outstanding on earlier linked lines.
 */
export async function createPurchaseSupplementLine(
  tx: Prisma.TransactionClient,
  scope: Scope,
  input: PurchaseSupplementInput,
) {
  if (input.kind !== PurchaseLineRelationKind.EXTRA_ORDER &&
      input.kind !== PurchaseLineRelationKind.REPLACEMENT_DELIVERY) {
    throw new Error("关联明细类型无效");
  }
  const relationKey = input.relationKey?.trim();
  if (!relationKey) throw new Error("关联明细幂等键不能为空");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.tenantId}:${relationKey}`}))`;
  const existing = await tx.purchaseOrderLine.findUnique({ where: { relationKey } });
  if (existing) {
    const order = await tx.purchaseOrder.findFirst({
      where: { id: existing.purchaseOrderId, tenantId: scope.tenantId, storeId: scope.storeId },
    });
    if (!order) throw new Error("关联明细幂等键已被其他门店使用");
    return { line: existing, idempotent: true };
  }

  const sourceRef = await tx.purchaseOrderLine.findFirst({
    where: {
      id: input.sourceLineId,
      relationKind: PurchaseLineRelationKind.ORIGINAL,
      purchaseOrder: { tenantId: scope.tenantId, storeId: scope.storeId },
    },
    select: { purchaseOrderId: true },
  });
  if (!sourceRef) throw new Error("原采购明细不存在或不属于当前门店");
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${sourceRef.purchaseOrderId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "PurchaseOrderLine" WHERE "purchaseOrderId" = ${sourceRef.purchaseOrderId} ORDER BY id FOR UPDATE`;

  const source = await tx.purchaseOrderLine.findFirst({
    where: {
      id: input.sourceLineId,
      relationKind: PurchaseLineRelationKind.ORIGINAL,
      purchaseOrder: { tenantId: scope.tenantId, storeId: scope.storeId },
    },
    include: {
      material: true,
      purchaseOrder: true,
      receiptLines: { select: { disposition: true, quantity: true } },
      supplementLines: {
        where: { relationKind: PurchaseLineRelationKind.REPLACEMENT_DELIVERY },
        include: { receiptLines: { select: { disposition: true, quantity: true } } },
      },
    },
  });
  if (!source) throw new Error("原采购明细不存在或不属于当前门店");
  if (source.purchaseOrder.state === PurchaseState.CANCELLED || source.purchaseOrder.state === PurchaseState.DRAFT) {
    throw new Error("采购单当前不能创建关联明细");
  }
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("关联数量必须大于零");
  try { assertMaterialQuantity(quantity, source.material.quantityScale); } catch {
    throw new Error("关联数量不符合物料计量精度");
  }
  const unitPrice = input.unitPrice === undefined
    ? Number(source.unitPrice)
    : money(input.unitPrice, "关联明细采购单价");

  if (input.kind === PurchaseLineRelationKind.REPLACEMENT_DELIVERY) {
    const rejectedOriginal = source.receiptLines
      .filter((row) => row.disposition === ReceiptDisposition.REJECTED)
      .reduce((sum, row) => sum + Number(row.quantity), 0);
    const committedReplacement = source.supplementLines.reduce((sum, line) => {
      const rejected = line.receiptLines
        .filter((row) => row.disposition === ReceiptDisposition.REJECTED)
        .reduce((lineSum, row) => lineSum + Number(row.quantity), 0);
      return sum + Math.max(0, Number(line.expectedBaseQty ?? line.orderedQty) - rejected);
    }, 0);
    const available = Math.max(0, Number((rejectedOriginal - committedReplacement).toFixed(3)));
    if (quantity > available + LINKED_EPSILON) {
      throw new Error(`补送数量超过尚未补回的拒收数量 ${available}${source.material.baseUnit}`);
    }
  }

  const line = await tx.purchaseOrderLine.create({ data: {
    purchaseOrderId: source.purchaseOrderId,
    materialId: source.materialId,
    orderedQty: quantity,
    purchaseUnit: source.purchaseUnit,
    expectedBaseQty: quantity,
    unitPrice,
    relationKind: input.kind,
    sourceLineId: source.id,
    relationKey,
  } });
  const hadReceipts = source.receiptLines.length > 0 || source.supplementLines.some((row) => row.receiptLines.length > 0);
  await tx.purchaseOrder.update({
    where: { id: source.purchaseOrderId },
    data: { state: hadReceipts ? PurchaseState.PARTIALLY_RECEIVED : PurchaseState.ORDERED },
  });
  await tx.auditEvent.create({ data: {
    tenantId: scope.tenantId,
    storeId: scope.storeId,
    actorStaffId: scope.actorStaffId,
    action: input.kind === PurchaseLineRelationKind.EXTRA_ORDER
      ? "PURCHASE_EXTRA_LINE_CREATED" : "PURCHASE_REDELIVERY_LINE_CREATED",
    entityType: "PurchaseOrderLine",
    entityId: line.id,
    afterSnapshot: {
      purchaseOrderId: source.purchaseOrderId,
      sourceLineId: source.id,
      relationKind: input.kind,
      quantity,
      baseUnit: source.material.baseUnit,
    },
  } });
  return { line, idempotent: false };
}

export type LinkedPurchaseOrderInput = {
  supplierId: string;
  expectedAt?: Date;
  quantity: number;
  unitPrice: number;
  freightCost: number;
  packagingCost: number;
  otherCost: number;
  notes?: string | null;
  requirementId: string;
  allocationQuantity: number;
  idempotencyKey: string;
};

export type LinkedPurchaseOrderResult = {
  purchaseOrderId: string;
  purchaseLineId: string;
  number: string;
  allocatedQty: number;
  remainingShortage: number;
  baseUnit: string;
  idempotent: boolean;
};

const LINKED_EPSILON = 1e-8;

function linkedQuantity(value: Prisma.Decimal | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(3)) : 0;
}

/**
 * The linked-purchase number is a deterministic digest of the trimmed request key, so a retried
 * submission targets the same PurchaseOrder row instead of creating a second order.
 */
export function linkedPurchaseOrderNumber(idempotencyKey: string): string {
  const key = idempotencyKey?.trim();
  if (!key) throw new Error("幂等键不能为空");
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 24).toUpperCase();
  return `PO-LINK-${digest}`;
}

type LoadedShortageRequirement = {
  id: string;
  materialId: string;
  material: { baseUnit: string; quantityScale: number; tenantId: string };
  plannedQty: number;
  pendingAssociationQty: number;
};

/**
 * Re-reads the requirement with its latest revision, active reservations and purchase allocations.
 * All checks are tenant/store scoped; callers never pass a tenant or store from form input.
 */
async function loadShortageRequirement(
  tx: Prisma.TransactionClient,
  scope: Scope,
  requirementId: string,
): Promise<LoadedShortageRequirement> {
  const requirement = await tx.orderMaterialRequirement.findFirst({
    where: {
      id: requirementId,
      orderItem: { order: { tenantId: scope.tenantId, storeId: scope.storeId } },
    },
    include: {
      material: {
        select: { id: true, tenantId: true, baseUnit: true, quantityScale: true },
      },
      reservations: { where: { state: ReservationState.ACTIVE }, select: { quantity: true } },
      purchaseAllocations: { select: { allocatedQty: true } },
      orderItem: {
        include: {
          order: {
            select: {
              tenantId: true,
              storeId: true,
              revisions: { orderBy: { number: "desc" }, take: 1, select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!requirement) throw new Error("缺料需求不存在或不属于当前门店");
  if (requirement.material.tenantId !== scope.tenantId) {
    throw new Error("缺料需求物料不属于当前租户");
  }
  const latestRevision = requirement.orderItem.order.revisions[0];
  if (!latestRevision || requirement.revisionId !== latestRevision.id) {
    throw new Error("只能为订单最新版的缺料需求创建采购单");
  }
  const reservedQty = requirement.reservations.reduce(
    (sum, row) => sum + Number(row.quantity ?? 0),
    0,
  );
  const allocatedQty = requirement.purchaseAllocations.reduce(
    (sum, row) => sum + Number(row.allocatedQty ?? 0),
    0,
  );
  const currentShortage = Math.max(0, Number(requirement.plannedQty) - reservedQty);
  return {
    id: requirement.id,
    materialId: requirement.materialId,
    material: requirement.material,
    plannedQty: Number(requirement.plannedQty),
    pendingAssociationQty: Math.max(0, linkedQuantity(currentShortage - allocatedQty)),
  };
}

/**
 * Creates one formal ORDERED purchase order with a single line for a latest-revision shortage
 * requirement and attributes the requested quantity to that requirement in the same caller
 * transaction. The caller owns the transaction, so a failure at any step rolls back the draft.
 *
 * Idempotency: the number is derived from the trimmed key and guarded by a tenant-scoped
 * transaction advisory lock, so concurrent or repeated submissions reuse the first order and
 * allocation instead of creating a second one.
 */
export async function createLinkedPurchaseOrder(
  tx: Prisma.TransactionClient,
  scope: { tenantId: string; storeId: string; actorStaffId: string },
  input: LinkedPurchaseOrderInput,
): Promise<LinkedPurchaseOrderResult> {
  if (!scope.tenantId || !scope.storeId) throw new Error("缺少租户或门店信息");
  const actorStaffId = scope.actorStaffId?.trim();
  if (!actorStaffId) throw new Error("缺少操作员工信息");
  const requirementId = input.requirementId?.trim();
  if (!requirementId) throw new Error("缺料需求不能为空");
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey) throw new Error("幂等键不能为空");
  const number = linkedPurchaseOrderNumber(idempotencyKey);

  // Serialize same-key retries before the existence check. The unique (tenantId, number) index
  // remains the final guard if the transaction is ever driven outside this function.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`${scope.tenantId}:${number}`}))
  `;

  const existing = await tx.purchaseOrder.findUnique({
    where: { tenantId_number: { tenantId: scope.tenantId, number } },
    include: {
      lines: {
        orderBy: { createdAt: "asc" },
        include: {
          material: { select: { baseUnit: true } },
          allocations: {
            where: { requirementId },
            select: { id: true, allocatedQty: true },
          },
        },
      },
    },
  });
  if (existing) {
    if (existing.storeId !== scope.storeId) {
      throw new Error("幂等采购单不属于当前门店");
    }
    const line = existing.lines[0];
    if (!line) throw new Error("幂等采购单缺少采购明细，需人工处理");
    const allocation = line.allocations[0];
    if (!allocation) throw new Error("幂等采购单缺少缺料关联，需人工处理");
    const requirement = await loadShortageRequirement(tx, scope, requirementId);
    return {
      purchaseOrderId: existing.id,
      purchaseLineId: line.id,
      number: existing.number,
      allocatedQty: linkedQuantity(allocation.allocatedQty),
      remainingShortage: requirement.pendingAssociationQty,
      baseUnit: requirement.material.baseUnit,
      idempotent: true,
    };
  }

  const requirement = await loadShortageRequirement(tx, scope, requirementId);
  if (requirement.pendingAssociationQty <= LINKED_EPSILON) {
    throw new Error("该缺料需求已完成采购关联，无需重复创建采购单");
  }
  const allocationQuantity = Number(input.allocationQuantity);
  if (!Number.isFinite(allocationQuantity) || allocationQuantity <= 0) {
    throw new Error("分配数量必须大于零");
  }
  try {
    assertMaterialQuantity(allocationQuantity, requirement.material.quantityScale);
  } catch {
    throw new Error("分配数量必须符合物料计量精度");
  }
  if (allocationQuantity > requirement.pendingAssociationQty + LINKED_EPSILON) {
    throw new Error(
      `分配数量超过需求待关联缺口 ${linkedQuantity(requirement.pendingAssociationQty)}${requirement.material.baseUnit}`,
    );
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("采购数量必须大于零");
  }
  if (input.quantity + LINKED_EPSILON < allocationQuantity) {
    throw new Error("采购数量不能小于关联分配数量");
  }

  const draft = await createPurchaseDraft(tx, scope, number, {
    supplierId: input.supplierId,
    expectedAt: input.expectedAt,
    freightCost: input.freightCost,
    packagingCost: input.packagingCost,
    otherCost: input.otherCost,
    notes: input.notes,
    lines: [{
      materialId: requirement.materialId,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
    }],
  });
  const line = draft.lines[0];
  if (!line) throw new Error("采购单缺少采购明细");
  await submitPurchaseOrder(tx, scope, draft.id);
  const allocation = await allocatePurchaseDemand(tx, {
    tenantId: scope.tenantId,
    storeId: scope.storeId,
    purchaseLineId: line.id,
    requirementId: requirement.id,
    quantity: allocationQuantity,
    actorStaffId,
  });
  return {
    purchaseOrderId: draft.id,
    purchaseLineId: line.id,
    number: draft.number,
    allocatedQty: linkedQuantity(allocation.allocatedQty),
    remainingShortage: linkedQuantity(allocation.requirement.remainingShortage),
    baseUnit: allocation.baseUnit,
    idempotent: false,
  };
}
