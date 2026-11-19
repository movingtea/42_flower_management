import {
  CommercialState, FulfillmentKind, OrderEntry, OrderItemKind, PrismaClient, ProductionState,
  RecipeState, SupplyState,
} from "../../generated/prisma-v2/client";
import { expandRecipe } from "../domain/stock-planning";
import { reserveOrderMaterial } from "./reserve-order-material";

export type CreateManualOrderItemInput = {
  skuId: string;
  quantity: number;
};

export type CreateManualOrderInput = {
  tenantId: string;
  storeId: string;
  /** Staff user that created the order; stored on the ORDER_CREATED audit event. */
  actorStaffId?: string | null;
  deliveryAt: Date;
  buyerName?: string;
  fulfillmentKind: "PICKUP" | "DELIVERY";
  recipientName?: string;
  recipientPhone?: string;
  address?: string;
  deliveryFee?: number;
  estimatedDeliveryCost?: number;
  /** Legacy single-line callers keep using skuId/quantity. */
  skuId?: string;
  quantity?: number;
  /** Preferred manual-order shape: 1..20 unique SKU lines. */
  items?: CreateManualOrderItemInput[];
};

const MAX_MANUAL_ORDER_ITEMS = 20;

function normalizeOrderItems(input: CreateManualOrderInput): CreateManualOrderItemInput[] {
  const hasItems = input.items !== undefined;
  const items = hasItems
    ? input.items ?? []
    : input.skuId !== undefined && input.quantity !== undefined
      ? [{ skuId: input.skuId, quantity: input.quantity }]
      : [];

  if (items.length === 0) throw new Error("请至少选择一个商品");
  if (items.length > MAX_MANUAL_ORDER_ITEMS) throw new Error("一个订单最多包含 20 个商品行");

  const seen = new Set<string>();
  return items.map((item) => {
    const skuId = typeof item?.skuId === "string" ? item.skuId.trim() : "";
    if (!skuId) throw new Error("请选择商品 SKU");
    if (seen.has(skuId)) throw new Error("同一订单不能重复选择相同 SKU");
    seen.add(skuId);
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error("商品数量必须为正整数");
    return { skuId, quantity: item.quantity };
  });
}

function assertNonnegativeAmount(value: unknown, label: string): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}必须为非负有限数`);
  }
}

function assertDeliveryInput(input: CreateManualOrderInput): void {
  if (!(input.deliveryAt instanceof Date) ||
    !Number.isFinite(input.deliveryAt.getTime()) ||
    input.deliveryAt <= new Date()) {
    throw new Error("交付时间必须晚于当前时间");
  }
  if (input.fulfillmentKind === "DELIVERY" && (!input.recipientName?.trim() || !input.recipientPhone?.trim() || !input.address?.trim())) {
    throw new Error("配送订单必须填写收件人、电话和地址");
  }
  assertNonnegativeAmount(input.deliveryFee, "配送费用");
  assertNonnegativeAmount(input.estimatedDeliveryCost, "预计配送成本");
}

/**
 * Creates a staff-portal manual order with 1..20 independent SKU lines.
 *
 * Legacy callers pass one skuId/quantity. The order, every line snapshot, the first
 * revision and the fulfillment plan are written in one transaction, so a missing SKU,
 * an unpublished recipe or any invalid line never leaves a partial order behind.
 */
export async function createManualOrder(
  db: PrismaClient,
  input: CreateManualOrderInput,
) {
  assertDeliveryInput(input);
  const items = normalizeOrderItems(input);

  return db.$transaction(async (tx) => {
    if (typeof input.storeId !== "string" || input.storeId.trim().length === 0) {
      throw new Error("门店不存在");
    }
    const store = await tx.store.findUnique({
      where: { id: input.storeId },
      select: { tenantId: true },
    });
    // Non-disclosing: cross-tenant and nonexistent stores fail identically before any write.
    if (!store || store.tenantId !== input.tenantId) throw new Error("门店不存在");

    const skus = await tx.productSku.findMany({
      where: {
        id: { in: items.map((item) => item.skuId) },
        active: true,
        product: { active: true, tenantId: input.tenantId },
      },
      include: {
        product: true,
        recipe: {
          include: {
            versions: { where: { state: RecipeState.PUBLISHED }, orderBy: { versionNo: "desc" }, take: 1 },
          },
        },
      },
    });
    if (skus.length !== items.length) throw new Error("SKU 不属于当前门店或未上架");
    const skuById = new Map(skus.map((sku) => [sku.id, sku]));

    const snapshots = items.map((item) => {
      const sku = skuById.get(item.skuId);
      if (!sku) throw new Error("SKU 不属于当前门店或未上架");
      const version = sku.recipe?.versions[0];
      if (!version) throw new Error("SKU 尚无已发布配方");
      return {
        kind: OrderItemKind.STANDARD,
        skuId: sku.id,
        recipeVersionId: version.id,
        nameSnapshot: `${sku.product.name} / ${sku.name}`,
        quantity: item.quantity,
        unitPrice: sku.price,
        estimatedConsumableCostSnapshot: sku.estimatedConsumableCost,
        estimatedLaborCostSnapshot: sku.estimatedLaborCost,
      };
    });

    const order = await tx.order.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        number: `M-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
        createdVia: OrderEntry.STAFF_PORTAL,
        sourceChannel: "后台录单",
        commercialState: CommercialState.DRAFT,
        deliveryAt: input.deliveryAt,
        buyerNameSnapshot: input.buyerName?.trim() || null,
        recipientNameSnapshot: input.recipientName?.trim() || null,
        recipientPhoneSnapshot: input.recipientPhone?.trim() || null,
        addressSnapshot: input.address?.trim() || null,
      },
    });
    await tx.orderItem.createMany({
      data: snapshots.map((snapshot) => ({ ...snapshot, orderId: order.id })),
    });
    await tx.orderRevision.create({ data: { orderId: order.id, number: 1, reason: "创建后台订单" } });
    await tx.fulfillment.create({
      data: {
        orderId: order.id,
        kind: input.fulfillmentKind === "PICKUP" ? FulfillmentKind.PICKUP : FulfillmentKind.DELIVERY,
        scheduledAt: input.deliveryAt,
        recipientName: input.recipientName?.trim() || null,
        recipientPhone: input.recipientPhone?.trim() || null,
        addressSnapshot: input.address?.trim() || null,
        deliveryFeeCharged: input.fulfillmentKind === "DELIVERY" ? input.deliveryFee ?? 0 : 0,
        deliveryCostEstimated: input.fulfillmentKind === "DELIVERY" ? input.estimatedDeliveryCost ?? null : null,
      },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        actorStaffId: input.actorStaffId?.trim() || null,
        action: "ORDER_CREATED",
        entityType: "Order",
        entityId: order.id,
        afterSnapshot: {
          number: order.number,
          items: items.map((item) => ({ skuId: item.skuId, quantity: item.quantity })),
          deliveryAt: input.deliveryAt.toISOString(),
          fulfillmentKind: input.fulfillmentKind,
        },
      },
    });
    return order.id;
  }, { timeout: 30_000 });
}

export async function confirmManualOrder(
  db: PrismaClient,
  orderId: string,
  tenantId: string,
  storeId: string,
  actorStaffId?: string | null,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        revisions: { orderBy: { number: "desc" }, take: 1 },
      },
    });
    if (!order || order.tenantId !== tenantId || order.storeId !== storeId) throw new Error("订单不存在");
    if (order.commercialState !== CommercialState.DRAFT && order.commercialState !== CommercialState.PENDING_CONFIRMATION) {
      throw new Error("订单当前状态不能确认");
    }
    if (!order.deliveryAt) throw new Error("订单交付时间未填写");
    const revision = order.revisions[0];
    if (!revision) throw new Error("订单缺少修订记录");
    let totalShortage = 0;
    for (const item of order.items) {
      if (!item.recipeVersionId) throw new Error("订单项尚无确定配方");
      const lines = await tx.recipeLine.findMany({
        where: { versionId: item.recipeVersionId }, include: { material: true },
      });
      const requirements = expandRecipe(lines.map((line) => ({
        materialId: line.materialId,
        perUnitQuantity: Number(line.plannedQty),
        expectedLossRate: Number(line.expectedLossRate),
        reservePerOrder: line.material.reservePerOrder,
        quantityScale: line.material.quantityScale,
      })), item.quantity, order.deliveryAt);
      for (const requirement of requirements) {
        let stored = await tx.orderMaterialRequirement.findFirst({
          where: { orderItemId: item.id, revisionId: revision.id, materialId: requirement.materialId },
        });
        if (!stored) {
          stored = await tx.orderMaterialRequirement.create({
            data: { orderItemId: item.id, revisionId: revision.id, materialId: requirement.materialId, plannedQty: requirement.quantity, needBy: requirement.needBy },
          });
        }
        const allocation = await reserveOrderMaterial(tx, stored.id);
        totalShortage += allocation.shortage;
      }
      const task = await tx.productionTask.findFirst({ where: { orderItemId: item.id } });
      if (!task) await tx.productionTask.create({ data: { orderItemId: item.id, quantity: item.quantity, state: ProductionState.WAITING_MATERIAL } });
    }
    const covered = totalShortage <= 1e-8;
    const nextCommercialState = covered ? CommercialState.CONFIRMED : CommercialState.PENDING_CONFIRMATION;
    const nextSupplyState = covered ? SupplyState.ON_HAND_COVERED : SupplyState.PURCHASE_REQUIRED;
    const nextProductionState = covered ? ProductionState.READY : ProductionState.WAITING_MATERIAL;
    await tx.order.update({
      where: { id: orderId },
      data: {
        commercialState: nextCommercialState,
        supplyState: nextSupplyState,
        productionState: nextProductionState,
      },
    });
    if (covered) await tx.productionTask.updateMany({ where: { orderItem: { orderId } }, data: { state: ProductionState.READY } });
    // A supply recheck can run this again while a short order stays pending. Only an
    // actual state transition is a confirmation event; a no-op replay must not audit.
    const stateChanged = order.commercialState !== nextCommercialState
      || order.supplyState !== nextSupplyState
      || order.productionState !== nextProductionState;
    if (stateChanged) {
      await tx.auditEvent.create({
        data: {
          tenantId,
          storeId,
          actorStaffId: actorStaffId?.trim() || null,
          action: "ORDER_CONFIRMED",
          entityType: "Order",
          entityId: orderId,
          beforeSnapshot: {
            commercialState: order.commercialState,
            supplyState: order.supplyState,
          },
          afterSnapshot: {
            commercialState: nextCommercialState,
            supplyState: nextSupplyState,
            totalShortage,
          },
        },
      });
    }
    return { covered, totalShortage };
  }, { timeout: 30_000 });
}
