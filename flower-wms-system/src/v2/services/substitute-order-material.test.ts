import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState, LocationKind, MaterialKind, OrderEntry, PrismaClient,
  ProductionState, PurchaseState, RecipeState, ReservationState, SupplyState,
} from "../../generated/prisma-v2/client";
import { confirmManualOrder, createManualOrder } from "./manual-order";
import { reviseManualOrder } from "./revise-order";
import { substituteOrderMaterial } from "./substitute-order-material";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for substitute-order-material tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

let primaryTenantId: string | undefined;
let secondaryTenantId: string | undefined;
let mainStoreId: string | undefined;
let otherStoreId: string | undefined;
let warehouseId: string | undefined;
let supplierId: string | undefined;

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

type MaterialOptions = {
  tenantId?: string;
  baseUnit?: string;
  quantityScale?: number;
  grade?: string | null;
  color?: string | null;
  specification?: string | null;
  gradeSpecification?: string | null;
};

function loadOrder(orderId: string) {
  return db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: {
        include: {
          requirements: {
            include: {
              material: true,
              reservations: true,
              purchaseAllocations: true,
            },
          },
          tasks: true,
        },
      },
      revisions: { orderBy: { number: "asc" } },
      fulfillment: true,
    },
  });
}

type LoadedOrder = Awaited<ReturnType<typeof loadOrder>>;

function activeTotal(order: LoadedOrder): number {
  return order.items
    .flatMap((item) => item.requirements)
    .flatMap((requirement) => requirement.reservations)
    .filter((reservation) => reservation.state === ReservationState.ACTIVE)
    .reduce((sum, reservation) => sum + Number(reservation.quantity), 0);
}

function requirementActiveTotal(requirement: {
  reservations: { state: ReservationState; quantity: unknown }[];
}): number {
  return requirement.reservations
    .filter((reservation) => reservation.state === ReservationState.ACTIVE)
    .reduce((sum, reservation) => sum + Number(reservation.quantity), 0);
}

function latestRequirements(order: LoadedOrder) {
  const latestRevision = order.revisions[order.revisions.length - 1];
  assert.ok(latestRevision);
  return {
    latestRevision,
    requirements: order.items
      .flatMap((item) => item.requirements)
      .filter((requirement) => requirement.revisionId === latestRevision.id),
  };
}

async function createMaterial(label: string, options: MaterialOptions = {}) {
  const tenantId = options.tenantId ?? primaryTenantId;
  assert.ok(tenantId);
  return db.material.create({
    data: {
      tenantId,
      code: `MAT-${label}-${crypto.randomUUID().slice(0, 8)}`,
      name: `${label} 花材`,
      kind: MaterialKind.FLOWER,
      baseUnit: options.baseUnit ?? "支",
      quantityScale: options.quantityScale ?? 0,
      grade: options.grade ?? null,
      color: options.color ?? null,
      specification: options.specification ?? null,
      gradeSpecification: options.gradeSpecification ?? null,
    },
  });
}

async function addBatch(materialId: string, onHand: number): Promise<string> {
  assert.ok(mainStoreId && warehouseId);
  const batch = await db.inventoryBatch.create({
    data: {
      storeId: mainStoreId,
      materialId,
      batchNo: `BATCH-${crypto.randomUUID().slice(0, 8)}`,
      unitCost: 2,
    },
  });
  if (onHand > 0) {
    await db.batchBalance.create({
      data: { batchId: batch.id, locationId: warehouseId, onHandQty: onHand },
    });
  }
  return batch.id;
}

async function createSku(
  label: string,
  lines: { materialId: string; plannedQty: number }[],
): Promise<{ skuId: string; versionId: string }> {
  assert.ok(primaryTenantId);
  const code = `${label}-${crypto.randomUUID().slice(0, 8)}`;
  const product = await db.product.create({
    data: { tenantId: primaryTenantId, code: `PROD-${code}`, name: `${label} 花束` },
  });
  const sku = await db.productSku.create({
    data: {
      productId: product.id,
      code: `SKU-${code}`,
      name: "标准款",
      price: 99,
      estimatedConsumableCost: 1,
      estimatedLaborCost: 2,
      active: true,
    },
  });
  await db.product.update({
    where: { id: product.id },
    data: { active: true, defaultSkuId: sku.id },
  });
  const recipe = await db.recipe.create({ data: { skuId: sku.id } });
  const version = await db.recipeVersion.create({
    data: {
      recipeId: recipe.id,
      versionNo: 1,
      state: RecipeState.PUBLISHED,
      publishedAt: new Date(),
      lines: { create: lines },
    },
  });
  return { skuId: sku.id, versionId: version.id };
}

async function createPendingOrder(skuId: string, quantity: number): Promise<{
  orderId: string;
  covered: boolean;
  totalShortage: number;
}> {
  assert.ok(primaryTenantId && mainStoreId);
  const orderId = await createManualOrder(db, {
    tenantId: primaryTenantId,
    storeId: mainStoreId,
    skuId,
    quantity,
    deliveryAt: futureDate(3),
    buyerName: "替换测试",
    fulfillmentKind: "PICKUP",
  });
  const confirmation = await confirmManualOrder(db, orderId, primaryTenantId, mainStoreId);
  return { orderId, ...confirmation };
}

function baseSubstitution(orderId: string, requirementId: string, replacementMaterialId: string, replacementQty: number) {
  assert.ok(primaryTenantId && mainStoreId);
  return {
    tenantId: primaryTenantId,
    storeId: mainStoreId,
    orderId,
    requirementId,
    replacementMaterialId,
    replacementQty,
    reason: "人工确认替换",
    customerConfirmed: false,
    actorStaffId: "staff-substitute",
  };
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `substitute-primary-${marker}`, name: "替换测试主租户" },
  });
  primaryTenantId = tenant.id;
  const secondaryTenant = await db.tenant.create({
    data: { slug: `substitute-secondary-${marker}`, name: "替换测试其他租户" },
  });
  secondaryTenantId = secondaryTenant.id;
  const store = await db.store.create({
    data: { tenantId: tenant.id, code: "MAIN", name: "替换测试主店" },
  });
  mainStoreId = store.id;
  const otherStore = await db.store.create({
    data: { tenantId: tenant.id, code: "OTHER", name: "替换测试他店" },
  });
  otherStoreId = otherStore.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId: store.id, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  await db.inventoryLocation.create({
    data: { storeId: store.id, code: "PRODUCTION", kind: LocationKind.PRODUCTION },
  });
  const supplier = await db.supplier.create({
    data: { tenantId: tenant.id, code: `SUP-${marker}`, name: "替换测试供应商" },
  });
  supplierId = supplier.id;

  // Covered replacement, audit facts, and later quantity revision preserving substitution.
  const coverOriginal = await createMaterial("cover-original", {
    grade: "A", color: "红", specification: "60cm", gradeSpecification: "A-60",
  });
  await addBatch(coverOriginal.id, 0);
  const coverReplacement = await createMaterial("cover-replacement", {
    grade: "A", color: "红", specification: "60cm", gradeSpecification: "A-60",
  });
  const coverReplacementBatch = await addBatch(coverReplacement.id, 100);
  const coverSku = await createSku("cover", [{ materialId: coverOriginal.id, plannedQty: 5 }]);
  const coverOrder = await createPendingOrder(coverSku.skuId, 2);
  assert.equal(coverOrder.covered, false);
  assert.equal(coverOrder.totalShortage, 10);

  const beforeCover = await loadOrder(coverOrder.orderId);
  const coverTarget = latestRequirements(beforeCover).requirements
    .find((requirement) => requirement.materialId === coverOriginal.id);
  assert.ok(coverTarget);
  const coverResult = await substituteOrderMaterial(db, {
    ...baseSubstitution(coverOrder.orderId, coverTarget.id, coverReplacement.id, 10),
    reason: "同品种同等级替换",
  });
  assert.equal(coverResult.covered, true);
  assert.equal(coverResult.totalShortage, 0);
  assert.equal(coverResult.revisionNumber, 2);
  assert.equal(coverResult.customerVisibleChange, false);

  const afterCover = await loadOrder(coverOrder.orderId);
  assert.equal(afterCover.commercialState, CommercialState.CONFIRMED);
  assert.equal(afterCover.supplyState, SupplyState.ON_HAND_COVERED);
  assert.equal(afterCover.productionState, ProductionState.READY);
  assert.equal(afterCover.version, 2);
  assert.equal(afterCover.items[0].quantity, 2);
  assert.equal(afterCover.revisions.length, 2);
  assert.equal(afterCover.items[0].tasks[0].state, ProductionState.READY);
  const coverOldRequirement = afterCover.items[0].requirements
    .find((requirement) => requirement.id === coverTarget.id);
  assert.ok(coverOldRequirement);
  assert.equal(Number(coverOldRequirement.plannedQty), 10);
  assert.equal(coverOldRequirement.materialId, coverOriginal.id);
  assert.ok(coverOldRequirement.reservations.every(
    (reservation) => reservation.state === ReservationState.RELEASED,
  ));
  const coverNewRequirement = afterCover.items[0].requirements
    .find((requirement) => requirement.revisionId === coverResult.revisionId);
  assert.ok(coverNewRequirement);
  assert.equal(coverNewRequirement.materialId, coverReplacement.id);
  assert.equal(Number(coverNewRequirement.plannedQty), 10);
  assert.equal(requirementActiveTotal(coverNewRequirement), 10);

  const coverAudit = await db.auditEvent.findFirstOrThrow({
    where: { entityId: coverOrder.orderId, action: "ORDER_MATERIAL_SUBSTITUTED" },
  });
  assert.equal(coverAudit.actorStaffId, "staff-substitute");
  assert.equal(coverAudit.tenantId, tenant.id);
  assert.equal(coverAudit.storeId, store.id);
  const coverBeforeSnapshot = coverAudit.beforeSnapshot as unknown as Record<string, unknown>;
  const coverAfterSnapshot = coverAudit.afterSnapshot as unknown as Record<string, unknown>;
  assert.equal(coverBeforeSnapshot.materialId, coverOriginal.id);
  assert.equal(coverBeforeSnapshot.plannedQty, 10);
  assert.equal(coverBeforeSnapshot.requirementId, coverTarget.id);
  assert.equal(coverAfterSnapshot.materialId, coverReplacement.id);
  assert.equal(coverAfterSnapshot.plannedQty, 10);
  assert.equal(coverAfterSnapshot.reason, "同品种同等级替换");
  assert.equal(coverAfterSnapshot.customerConfirmed, false);
  assert.equal(coverAfterSnapshot.customerVisibleChange, false);

  const coverRevision = await reviseManualOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: coverOrder.orderId,
    quantity: 3,
    deliveryAt: futureDate(5),
  });
  assert.equal(coverRevision.covered, true);
  assert.equal(coverRevision.revisionNumber, 3);
  const afterCoverRevision = await loadOrder(coverOrder.orderId);
  assert.equal(afterCoverRevision.items[0].quantity, 3);
  assert.equal(afterCoverRevision.version, 3);
  const revisedCoverRequirements = latestRequirements(afterCoverRevision).requirements;
  assert.equal(revisedCoverRequirements.length, 1);
  assert.equal(revisedCoverRequirements[0].materialId, coverReplacement.id);
  assert.equal(Number(revisedCoverRequirements[0].plannedQty), 15);
  assert.equal(requirementActiveTotal(revisedCoverRequirements[0]), 15);
  const historicalCoverRequirement = afterCoverRevision.items[0].requirements
    .find((requirement) => requirement.id === coverNewRequirement.id);
  assert.ok(historicalCoverRequirement);
  assert.ok(historicalCoverRequirement.reservations.every(
    (reservation) => reservation.state === ReservationState.RELEASED,
  ));
  const coverReserved = await db.inventoryReservation.aggregate({
    where: { batchId: coverReplacementBatch, state: ReservationState.ACTIVE },
    _sum: { quantity: true },
  });
  assert.equal(Number(coverReserved._sum.quantity ?? 0), 15);
  console.log("substitute-order-material covered replacement and later revision passed");

  // Insufficient replacement stock is never overridable, even with explicit customer consent.
  // The failed transaction must leave the old revision, reservations and allocation untouched.
  const shortOriginal = await createMaterial("short-original", { baseUnit: "支", quantityScale: 0 });
  await addBatch(shortOriginal.id, 0);
  const shortReplacement = await createMaterial("short-replacement", {
    baseUnit: "支", quantityScale: 0, grade: "B",
  });
  const shortReplacementBatch = await addBatch(shortReplacement.id, 4);
  const shortSku = await createSku("short", [{ materialId: shortOriginal.id, plannedQty: 5 }]);
  const shortOrder = await createPendingOrder(shortSku.skuId, 2);
  assert.equal(shortOrder.covered, false);
  assert.equal(shortOrder.totalShortage, 10);
  const beforeShort = await loadOrder(shortOrder.orderId);
  const shortTarget = latestRequirements(beforeShort).requirements
    .find((requirement) => requirement.materialId === shortOriginal.id);
  assert.ok(shortTarget);

  assert.ok(supplierId);
  const originalPurchase = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      supplierId,
      number: `PO-ORIG-${marker}`,
      state: PurchaseState.ORDERED,
      lines: { create: {
        materialId: shortOriginal.id,
        orderedQty: 100,
        purchaseUnit: shortOriginal.baseUnit,
        expectedBaseQty: 100,
        unitPrice: 1,
      } },
    },
    include: { lines: true },
  });
  const allocation = await db.purchaseDemandAllocation.create({
    data: {
      purchaseLineId: originalPurchase.lines[0].id,
      requirementId: shortTarget.id,
      allocatedQty: 5,
    },
  });

  const shortActiveBefore = activeTotal(beforeShort);
  await assert.rejects(
    substituteOrderMaterial(db, {
      ...baseSubstitution(shortOrder.orderId, shortTarget.id, shortReplacement.id, 10),
      reason: "顾客已确认等级变化，但替换库存不足",
      customerConfirmed: true,
    }),
    /替换物料可用库存不足：需要 10支，当前可用 4支/,
  );
  const afterStockRejection = await loadOrder(shortOrder.orderId);
  assert.equal(afterStockRejection.revisions.length, 1);
  assert.equal(afterStockRejection.version, 1);
  assert.equal(afterStockRejection.commercialState, CommercialState.PENDING_CONFIRMATION);
  assert.equal(afterStockRejection.supplyState, SupplyState.PURCHASE_REQUIRED);
  assert.equal(afterStockRejection.productionState, ProductionState.WAITING_MATERIAL);
  assert.equal(afterStockRejection.items[0].tasks[0].state, ProductionState.WAITING_MATERIAL);
  assert.equal(activeTotal(afterStockRejection), shortActiveBefore);
  assert.equal(await db.auditEvent.count({
    where: { entityId: shortOrder.orderId, action: "ORDER_MATERIAL_SUBSTITUTED" },
  }), 0);
  const shortReservedOnReplacement = await db.inventoryReservation.aggregate({
    where: { batchId: shortReplacementBatch, state: ReservationState.ACTIVE },
    _sum: { quantity: true },
  });
  assert.equal(Number(shortReservedOnReplacement._sum.quantity ?? 0), 0);
  const preservedAllocation = await db.purchaseDemandAllocation.findUniqueOrThrow({
    where: { id: allocation.id },
  });
  assert.equal(preservedAllocation.requirementId, shortTarget.id);
  assert.equal(Number(preservedAllocation.allocatedQty), 5);
  const unchangedShortRequirement = afterStockRejection.items[0].requirements
    .find((requirement) => requirement.id === shortTarget.id);
  assert.ok(unchangedShortRequirement);
  assert.equal(unchangedShortRequirement.materialId, shortOriginal.id);
  assert.equal(Number(unchangedShortRequirement.plannedQty), 10);
  console.log("substitute-order-material mandatory insufficient-stock rejection and rollback passed");

  // Every customer-visible identity field requires explicit customer confirmation.
  const visibleIdentity = {
    grade: "A", color: "红", specification: "60cm", gradeSpecification: "A-60",
  };
  const visibleOriginal = await createMaterial("visible-original", visibleIdentity);
  await addBatch(visibleOriginal.id, 0);
  const visibleSku = await createSku("visible", [{ materialId: visibleOriginal.id, plannedQty: 5 }]);
  const visibleFields = ["grade", "color", "specification", "gradeSpecification"] as const;
  for (const field of visibleFields) {
    const visibleReplacement = await createMaterial(`visible-${field}`, {
      ...visibleIdentity,
      [field]: `${visibleIdentity[field]}-changed`,
    });
    await addBatch(visibleReplacement.id, 100);
    const visibleOrder = await createPendingOrder(visibleSku.skuId, 1);
    const visibleBefore = await loadOrder(visibleOrder.orderId);
    const visibleTarget = latestRequirements(visibleBefore).requirements
      .find((requirement) => requirement.materialId === visibleOriginal.id);
    assert.ok(visibleTarget);
    await assert.rejects(
      substituteOrderMaterial(db, baseSubstitution(
        visibleOrder.orderId, visibleTarget.id, visibleReplacement.id, 5,
      )),
      /顾客确认/,
    );
    const unchangedVisible = await loadOrder(visibleOrder.orderId);
    assert.equal(unchangedVisible.revisions.length, 1);
    assert.equal(unchangedVisible.version, 1);
    const unchangedTarget = unchangedVisible.items[0].requirements
      .find((requirement) => requirement.id === visibleTarget.id);
    assert.ok(unchangedTarget);
    assert.equal(requirementActiveTotal(unchangedTarget), 0);

    const confirmedResult = await substituteOrderMaterial(db, {
      ...baseSubstitution(visibleOrder.orderId, visibleTarget.id, visibleReplacement.id, 5),
      reason: `${field} 变化已获顾客同意`,
      customerConfirmed: true,
    });
    assert.equal(confirmedResult.customerVisibleChange, true);
    assert.equal(confirmedResult.customerConfirmed, true);
    const confirmedAudit = await db.auditEvent.findFirstOrThrow({
      where: { entityId: visibleOrder.orderId, action: "ORDER_MATERIAL_SUBSTITUTED" },
    });
    const confirmedAfter = confirmedAudit.afterSnapshot as unknown as Record<string, unknown>;
    assert.equal(confirmedAfter.customerConfirmed, true);
    assert.equal(confirmedAfter.customerVisibleChange, true);
    assert.equal(confirmedAfter.reason, `${field} 变化已获顾客同意`);
  }
  console.log("substitute-order-material customer-visible confirmation passed");

  // Ownership, identity, unit, scale, lifecycle and latest-revision rejection all leave the plan intact.
  const rejectOriginal = await createMaterial("reject-original");
  await addBatch(rejectOriginal.id, 0);
  const rejectReplacement = await createMaterial("reject-replacement");
  await addBatch(rejectReplacement.id, 100);
  const rejectSku = await createSku("reject", [{ materialId: rejectOriginal.id, plannedQty: 5 }]);
  const rejectOrder = await createPendingOrder(rejectSku.skuId, 1);
  const rejectBefore = await loadOrder(rejectOrder.orderId);
  const rejectTarget = latestRequirements(rejectBefore).requirements
    .find((requirement) => requirement.materialId === rejectOriginal.id);
  assert.ok(rejectTarget);
  const rejectActiveBefore = activeTotal(rejectBefore);

  const foreignMaterial = await createMaterial("foreign", { tenantId: secondaryTenant.id });
  await assert.rejects(
    substituteOrderMaterial(db, baseSubstitution(
      rejectOrder.orderId, rejectTarget.id, foreignMaterial.id, 5,
    )),
    /租户/,
  );
  await assert.rejects(
    substituteOrderMaterial(db, baseSubstitution(
      rejectOrder.orderId, rejectTarget.id, rejectOriginal.id, 5,
    )),
    /不同/,
  );
  const differentUnit = await createMaterial("different-unit", { baseUnit: "扎" });
  await addBatch(differentUnit.id, 100);
  await assert.rejects(
    substituteOrderMaterial(db, baseSubstitution(
      rejectOrder.orderId, rejectTarget.id, differentUnit.id, 5,
    )),
    /单位/,
  );
  await assert.rejects(
    substituteOrderMaterial(db, baseSubstitution(
      rejectOrder.orderId, rejectTarget.id, rejectReplacement.id, 1.5,
    )),
    /精度/,
  );
  await assert.rejects(
    substituteOrderMaterial(db, baseSubstitution(
      rejectOrder.orderId, rejectTarget.id, rejectReplacement.id, 0,
    )),
    /大于零/,
  );
  const foreignTenantInput = {
    ...baseSubstitution(rejectOrder.orderId, rejectTarget.id, rejectReplacement.id, 5),
    tenantId: secondaryTenant.id,
  };
  await assert.rejects(substituteOrderMaterial(db, foreignTenantInput), /订单不存在/);
  assert.ok(otherStoreId);
  const otherStoreInput = {
    ...baseSubstitution(rejectOrder.orderId, rejectTarget.id, rejectReplacement.id, 5),
    storeId: otherStoreId,
  };
  await assert.rejects(substituteOrderMaterial(db, otherStoreInput), /订单不存在/);
  await assert.rejects(
    substituteOrderMaterial(db, {
      ...baseSubstitution(rejectOrder.orderId, rejectTarget.id, rejectReplacement.id, 5),
      reason: "   ",
    }),
    /原因/,
  );

  const rejectAfter = await loadOrder(rejectOrder.orderId);
  assert.equal(rejectAfter.revisions.length, 1);
  assert.equal(rejectAfter.version, 1);
  assert.equal(activeTotal(rejectAfter), rejectActiveBefore);

  const rejectResult = await substituteOrderMaterial(db, baseSubstitution(
    rejectOrder.orderId, rejectTarget.id, rejectReplacement.id, 5,
  ));
  assert.equal(rejectResult.covered, true);
  await assert.rejects(
    substituteOrderMaterial(db, baseSubstitution(
      rejectOrder.orderId, rejectTarget.id, rejectReplacement.id, 5,
    )),
    /最新版/,
  );

  const coveredOriginal = await createMaterial("covered-original");
  await addBatch(coveredOriginal.id, 100);
  const coveredSku = await createSku("covered", [{ materialId: coveredOriginal.id, plannedQty: 5 }]);
  const coveredOrder = await createPendingOrder(coveredSku.skuId, 1);
  assert.equal(coveredOrder.covered, true);
  const coveredBefore = await loadOrder(coveredOrder.orderId);
  const coveredTarget = latestRequirements(coveredBefore).requirements
    .find((requirement) => requirement.materialId === coveredOriginal.id);
  assert.ok(coveredTarget);
  await assert.rejects(
    substituteOrderMaterial(db, baseSubstitution(
      coveredOrder.orderId, coveredTarget.id, rejectReplacement.id, 5,
    )),
    /现货覆盖/,
  );

  const startedOrder = await createPendingOrder(rejectSku.skuId, 1);
  const startedBefore = await loadOrder(startedOrder.orderId);
  const startedTarget = latestRequirements(startedBefore).requirements
    .find((requirement) => requirement.materialId === rejectOriginal.id);
  assert.ok(startedTarget);
  await db.order.update({
    where: { id: startedOrder.orderId },
    data: { productionState: ProductionState.IN_PROGRESS },
  });
  await db.productionTask.updateMany({
    where: { orderItem: { orderId: startedOrder.orderId } },
    data: { state: ProductionState.IN_PROGRESS, startedAt: new Date() },
  });
  await assert.rejects(
    substituteOrderMaterial(db, baseSubstitution(
      startedOrder.orderId, startedTarget.id, rejectReplacement.id, 5,
    )),
    /已开始制作/,
  );

  const miniProgramOrder = await createPendingOrder(rejectSku.skuId, 1);
  const miniProgramBefore = await loadOrder(miniProgramOrder.orderId);
  const miniProgramTarget = latestRequirements(miniProgramBefore).requirements
    .find((requirement) => requirement.materialId === rejectOriginal.id);
  assert.ok(miniProgramTarget);
  await db.order.update({
    where: { id: miniProgramOrder.orderId },
    data: { createdVia: OrderEntry.MINI_PROGRAM },
  });
  await assert.rejects(
    substituteOrderMaterial(db, baseSubstitution(
      miniProgramOrder.orderId, miniProgramTarget.id, rejectReplacement.id, 5,
    )),
    /后台人工订单/,
  );
  console.log("substitute-order-material ownership and validation rejection passed");

  // Rollback: a copied invalid requirement fails reservation after revision creation and release.
  const rollbackOriginal = await createMaterial("rollback-original");
  const rollbackBatch = await addBatch(rollbackOriginal.id, 3);
  const rollbackInvalid = await createMaterial("rollback-invalid");
  await addBatch(rollbackInvalid.id, 0);
  const rollbackReplacement = await createMaterial("rollback-replacement");
  const rollbackReplacementBatch = await addBatch(rollbackReplacement.id, 100);
  const rollbackSku = await createSku("rollback", [
    { materialId: rollbackOriginal.id, plannedQty: 5 },
    { materialId: rollbackInvalid.id, plannedQty: 5 },
  ]);
  const rollbackOrder = await createPendingOrder(rollbackSku.skuId, 1);
  const rollbackBefore = await loadOrder(rollbackOrder.orderId);
  const rollbackTarget = latestRequirements(rollbackBefore).requirements
    .find((requirement) => requirement.materialId === rollbackOriginal.id);
  const rollbackInvalidRequirement = latestRequirements(rollbackBefore).requirements
    .find((requirement) => requirement.materialId === rollbackInvalid.id);
  assert.ok(rollbackTarget);
  assert.ok(rollbackInvalidRequirement);
  await db.orderMaterialRequirement.update({
    where: { id: rollbackInvalidRequirement.id },
    data: { plannedQty: 1.5 },
  });
  const rollbackActiveBefore = activeTotal(rollbackBefore);
  await assert.rejects(
    substituteOrderMaterial(db, baseSubstitution(
      rollbackOrder.orderId, rollbackTarget.id, rollbackReplacement.id, 5,
    )),
    /精度|base unit/,
  );
  const rollbackAfter = await loadOrder(rollbackOrder.orderId);
  assert.equal(rollbackAfter.revisions.length, 1);
  assert.equal(rollbackAfter.version, 1);
  assert.equal(activeTotal(rollbackAfter), rollbackActiveBefore);
  const rollbackOriginalAfter = rollbackAfter.items[0].requirements
    .find((requirement) => requirement.id === rollbackTarget.id);
  assert.ok(rollbackOriginalAfter);
  assert.equal(requirementActiveTotal(rollbackOriginalAfter), 3);
  assert.equal(await db.auditEvent.count({
    where: { entityId: rollbackOrder.orderId, action: "ORDER_MATERIAL_SUBSTITUTED" },
  }), 0);
  const rollbackReservation = await db.inventoryReservation.aggregate({
    where: { batchId: rollbackReplacementBatch, state: ReservationState.ACTIVE },
    _sum: { quantity: true },
  });
  assert.equal(Number(rollbackReservation._sum.quantity ?? 0), 0);
  const originalReservation = await db.inventoryReservation.aggregate({
    where: { batchId: rollbackBatch, state: ReservationState.ACTIVE },
    _sum: { quantity: true },
  });
  assert.equal(Number(originalReservation._sum.quantity ?? 0), 3);
  console.log("substitute-order-material rollback passed");

  // Concurrency: revision and substitution serialize on the order lock. Either the revision
  // wins and the stale substitution is rejected, or the substitution wins and the revision
  // scales the replacement composition.
  const concurrentOriginal = await createMaterial("concurrent-original");
  await addBatch(concurrentOriginal.id, 0);
  const concurrentReplacement = await createMaterial("concurrent-replacement");
  await addBatch(concurrentReplacement.id, 100);
  const concurrentSku = await createSku("concurrent", [{ materialId: concurrentOriginal.id, plannedQty: 5 }]);
  const concurrentOrder = await createPendingOrder(concurrentSku.skuId, 2);
  const concurrentBefore = await loadOrder(concurrentOrder.orderId);
  const concurrentTarget = latestRequirements(concurrentBefore).requirements
    .find((requirement) => requirement.materialId === concurrentOriginal.id);
  assert.ok(concurrentTarget);

  const [revisionOutcome, substitutionOutcome] = await Promise.allSettled([
    reviseManualOrder(db, {
      tenantId: tenant.id,
      storeId: store.id,
      orderId: concurrentOrder.orderId,
      quantity: 3,
      deliveryAt: futureDate(6),
    }),
    substituteOrderMaterial(db, baseSubstitution(
      concurrentOrder.orderId, concurrentTarget.id, concurrentReplacement.id, 10,
    )),
  ]);
  assert.equal(revisionOutcome.status, "fulfilled", "quantity revision must succeed");

  const concurrentAfter = await loadOrder(concurrentOrder.orderId);
  assert.equal(concurrentAfter.items[0].quantity, 3);
  const concurrentLatest = latestRequirements(concurrentAfter);
  assert.equal(concurrentLatest.requirements.length, 1);
  if (substitutionOutcome.status === "fulfilled") {
    assert.equal(concurrentAfter.revisions.length, 3);
    assert.equal(concurrentLatest.requirements[0].materialId, concurrentReplacement.id);
    assert.equal(Number(concurrentLatest.requirements[0].plannedQty), 15);
    assert.equal(requirementActiveTotal(concurrentLatest.requirements[0]), 15);
    assert.equal(concurrentAfter.productionState, ProductionState.READY);
    assert.equal(concurrentAfter.supplyState, SupplyState.ON_HAND_COVERED);
  } else {
    assert.match(String(substitutionOutcome.reason), /最新版/);
    assert.equal(concurrentAfter.revisions.length, 2);
    assert.equal(concurrentLatest.requirements[0].materialId, concurrentOriginal.id);
    assert.equal(Number(concurrentLatest.requirements[0].plannedQty), 15);
    assert.equal(requirementActiveTotal(concurrentLatest.requirements[0]), 0);
    assert.equal(concurrentAfter.productionState, ProductionState.WAITING_MATERIAL);
    assert.equal(concurrentAfter.supplyState, SupplyState.PURCHASE_REQUIRED);
  }
  console.log("substitute-order-material concurrency passed");

  console.log("v2 substitute order material tests passed");
}

async function cleanup() {
  const tenantIds = [primaryTenantId, secondaryTenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.costEntry.deleteMany({ where: { order: tenants } });
  await db.materialUsage.deleteMany({ where: { task: { orderItem: { order: tenants } } } });
  await db.lossRecord.deleteMany({ where: { store: tenants } });
  await db.inventoryTransaction.deleteMany({ where: { batch: { store: tenants } } });
  await db.sampleInventoryReservation.deleteMany({ where: { execution: { plan: tenants } } });
  await db.inventoryReservation.deleteMany({ where: { requirement: { orderItem: { order: tenants } } } });
  await db.purchaseDemandAllocation.deleteMany({
    where: {
      OR: [
        { requirement: { orderItem: { order: tenants } } },
        { purchaseLine: { purchaseOrder: tenants } },
      ],
    },
  });
  await db.purchaseOrderLine.deleteMany({ where: { purchaseOrder: tenants } });
  await db.purchaseOrder.deleteMany({ where: tenants });
  await db.orderMaterialRequirement.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.productionTask.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.fulfillment.deleteMany({ where: { order: tenants } });
  await db.orderItem.deleteMany({ where: { order: tenants } });
  await db.orderRevision.deleteMany({ where: { order: tenants } });
  await db.order.deleteMany({ where: tenants });
  await db.samplePlanExecution.deleteMany({ where: { plan: tenants } });
  await db.samplePlanRun.deleteMany({ where: { plan: tenants } });
  await db.samplePlan.deleteMany({ where: tenants });
  await db.batchBalance.deleteMany({ where: { batch: { store: tenants } } });
  await db.inventoryBatch.deleteMany({ where: { store: tenants } });
  await db.recipeLine.deleteMany({ where: { version: { recipe: { sku: { product: tenants } } } } });
  await db.recipeVersion.deleteMany({ where: { recipe: { sku: { product: tenants } } } });
  await db.recipe.deleteMany({ where: { sku: { product: tenants } } });
  await db.product.updateMany({ where: tenants, data: { defaultSkuId: null } });
  await db.productSku.deleteMany({ where: { product: tenants } });
  await db.product.deleteMany({ where: tenants });
  await db.material.deleteMany({ where: tenants });
  await db.inventoryLocation.deleteMany({ where: { store: tenants } });
  await db.store.deleteMany({ where: tenants });
  await db.supplier.deleteMany({ where: tenants });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      console.error("substitute-order-material cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
