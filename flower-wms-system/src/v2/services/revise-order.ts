import {
  CommercialState, FulfillmentState, OrderItemKind, PrismaClient,
  ProductionState, ReservationState, SupplyState,
} from "../../generated/prisma-v2-draft/client";
import { assertMaterialQuantity, expandRecipe } from "../domain/stock-planning";
import { reserveOrderMaterial } from "./reserve-order-material";

export type ReviseManualOrderItemInput = {
  orderItemId: string;
  quantity: number;
};

export type ReviseManualOrderInput = {
  tenantId: string;
  storeId: string;
  orderId: string;
  deliveryAt: Date;
  /** Legacy single-line callers keep using one quantity. */
  quantity?: number;
  /** Preferred shape: every existing order item exactly once with its new positive quantity. */
  items?: ReviseManualOrderItemInput[];
};

export type ReviseManualOrderResult = {
  orderId: string;
  revisionId: string;
  revisionNumber: number;
  covered: boolean;
  totalShortage: number;
};

const MAX_MANUAL_ORDER_ITEMS = 20;

const EDITABLE_COMMERCIAL_STATES: readonly CommercialState[] = [
  CommercialState.DRAFT,
  CommercialState.PENDING_CONFIRMATION,
  CommercialState.CONFIRMED,
];

const PRE_PRODUCTION_STATES: readonly ProductionState[] = [
  ProductionState.NOT_SCHEDULED,
  ProductionState.WAITING_MATERIAL,
  ProductionState.READY,
];

type LoadedOrderItem = {
  id: string;
  kind: OrderItemKind;
  quantity: number;
  recipeVersionId: string | null;
  tasks: { id: string; state: ProductionState; startedAt: Date | null; completedAt: Date | null }[];
  requirements: {
    id: string;
    revisionId: string;
    materialId: string;
    plannedQty: unknown;
    material: { quantityScale: number; tenantId: string };
  }[];
};

type RequestedItem = { orderItem: LoadedOrderItem; quantity: number };

/**
 * Scales a stored requirement by the item quantity ratio. Rounding up on the material's own
 * scale preserves the current composition (including any manual substitution) without ever
 * producing an invalid fractional quantity.
 */
function scaleRequirementQuantity(
  plannedQty: number,
  fromQuantity: number,
  toQuantity: number,
  quantityScale: number,
): number {
  if (!Number.isFinite(plannedQty) || plannedQty < 0 || fromQuantity <= 0) {
    throw new Error("订单物料需求数量无效");
  }
  const factor = 10 ** quantityScale;
  const scaled = Math.ceil((plannedQty * toQuantity / fromQuantity) * factor - 1e-8) / factor;
  assertMaterialQuantity(scaled, quantityScale);
  return scaled;
}

function normalizeRevisionItems(
  orderItems: LoadedOrderItem[],
  input: ReviseManualOrderInput,
): RequestedItem[] {
  const itemById = new Map(orderItems.map((item) => [item.id, item]));

  if (input.items !== undefined) {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new Error("请至少提交一个商品行数量");
    }
    if (input.items.length > MAX_MANUAL_ORDER_ITEMS) {
      throw new Error("一个订单最多包含 20 个商品行");
    }
    const seen = new Set<string>();
    const requested = input.items.map((entry) => {
      const orderItemId = typeof entry?.orderItemId === "string" ? entry.orderItemId.trim() : "";
      if (!orderItemId) throw new Error("商品行标识无效");
      const orderItem = itemById.get(orderItemId);
      if (!orderItem) throw new Error("订单项不属于当前订单");
      if (seen.has(orderItemId)) throw new Error("同一订单项不能重复提交数量");
      seen.add(orderItemId);
      if (!Number.isInteger(entry.quantity) || entry.quantity <= 0) {
        throw new Error("商品数量必须为正整数");
      }
      return { orderItem, quantity: entry.quantity };
    });
    if (requested.length !== orderItems.length) {
      throw new Error("修改订单必须包含所有现有商品行，且不能新增或删除商品");
    }
    return requested;
  }

  if (orderItems.length !== 1) {
    throw new Error("多商品订单必须提交每个商品行的新数量");
  }
  if (!Number.isInteger(input.quantity) || (input.quantity ?? 0) <= 0) {
    throw new Error("商品数量必须为正整数");
  }
  return [{ orderItem: orderItems[0], quantity: input.quantity as number }];
}

/**
 * Revises the quantity and delivery time of a standard manual order.
 *
 * Legacy callers send one quantity for a single-line order. Multi-line callers send every
 * existing order item exactly once. The whole plan changes in one transaction: either the new
 * revision, requirements, reservations, tasks and fulfillment schedule all land together, or
 * the old plan remains. SKU composition is never added, removed or changed here.
 */
export async function reviseManualOrder(
  db: PrismaClient,
  input: ReviseManualOrderInput,
): Promise<ReviseManualOrderResult> {
  if (!(input.deliveryAt instanceof Date) ||
    !Number.isFinite(input.deliveryAt.getTime()) ||
    input.deliveryAt <= new Date()) {
    throw new Error("交付时间必须晚于当前时间");
  }
  if (input.items === undefined && (input.quantity === undefined ||
    !Number.isInteger(input.quantity) || input.quantity <= 0)) {
    throw new Error("商品数量必须为正整数");
  }

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: { include: {
          tasks: true,
          requirements: { include: { material: true, reservations: true } },
        } },
        revisions: { orderBy: { number: "desc" }, take: 1 },
        fulfillment: true,
      },
    });
    if (!order || order.tenantId !== input.tenantId || order.storeId !== input.storeId) {
      throw new Error("订单不存在");
    }
    if (!EDITABLE_COMMERCIAL_STATES.includes(order.commercialState)) {
      throw new Error("订单当前状态不能修改");
    }
    if (order.fulfillmentState === FulfillmentState.DELIVERED || order.fulfillment?.handedOverAt) {
      throw new Error("订单已交付，不能修改");
    }
    if (!PRE_PRODUCTION_STATES.includes(order.productionState)) {
      throw new Error("订单已开始制作，不能修改");
    }
    if (order.items.length < 1 || order.items.length > MAX_MANUAL_ORDER_ITEMS) {
      throw new Error("订单商品行数量超出可修改范围");
    }
    if (order.items.some((item) => item.kind !== OrderItemKind.STANDARD)) {
      throw new Error("仅支持标准商品订单修改");
    }
    for (const item of order.items) {
      if (item.tasks.some((task) => task.startedAt || task.completedAt ||
        task.state === ProductionState.IN_PROGRESS ||
        task.state === ProductionState.COMPLETED ||
        task.state === ProductionState.EXCEPTION)) {
        throw new Error("订单已开始制作，不能修改");
      }
    }

    const requestedItems = normalizeRevisionItems(order.items as LoadedOrderItem[], input);

    const latestRevision = order.revisions[0];
    if (!latestRevision) throw new Error("订单缺少修订记录");
    const revisionNumber = latestRevision.number + 1;

    if (order.commercialState === CommercialState.DRAFT) {
      const revision = await tx.orderRevision.create({
        data: { orderId: order.id, number: revisionNumber, reason: "修改草稿数量与交付时间" },
      });
      for (const { orderItem, quantity } of requestedItems) {
        await tx.orderItem.update({ where: { id: orderItem.id }, data: { quantity } });
        if (orderItem.tasks.length > 0) {
          await tx.productionTask.updateMany({
            where: { orderItemId: orderItem.id },
            data: { quantity, state: ProductionState.NOT_SCHEDULED },
          });
        }
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          deliveryAt: input.deliveryAt,
          version: revisionNumber,
          ...(order.items.some((item) => item.tasks.length > 0)
            ? { productionState: ProductionState.NOT_SCHEDULED } : {}),
        },
      });
      await tx.fulfillment.updateMany({
        where: { orderId: order.id },
        data: { scheduledAt: input.deliveryAt },
      });
      return {
        orderId: order.id,
        revisionId: revision.id,
        revisionNumber,
        covered: false,
        totalShortage: 0,
      };
    }

    type ScaledRequirement = { materialId: string; quantity: number; needBy: Date };
    const plans: { orderItem: LoadedOrderItem; quantity: number; requirements: ScaledRequirement[] }[] = [];

    for (const { orderItem, quantity } of requestedItems) {
      const latestRequirements = orderItem.requirements
        .filter((requirement) => requirement.revisionId === latestRevision.id);

      let requirements: ScaledRequirement[];
      if (latestRequirements.length > 0) {
        // A pinned recipe snapshot must never point at another tenant's material. This is a data
        // integrity guard only; the new plan is derived from the latest requirements below so a
        // manual substitution survives later quantity/delivery revisions.
        if (orderItem.recipeVersionId) {
          const latestRecipeLines = await tx.recipeLine.findMany({
            where: { versionId: orderItem.recipeVersionId },
            include: { material: true },
          });
          if (latestRecipeLines.some((line) => line.material.tenantId !== order.tenantId)) {
            throw new Error("Recipe line material belongs to another tenant");
          }
        }
        requirements = latestRequirements.map((requirement) => ({
          materialId: requirement.materialId,
          quantity: scaleRequirementQuantity(
            Number(requirement.plannedQty),
            orderItem.quantity,
            quantity,
            requirement.material.quantityScale,
          ),
          needBy: input.deliveryAt,
        })).sort((left, right) => left.materialId.localeCompare(right.materialId));
      } else {
        if (!orderItem.recipeVersionId) throw new Error("订单项尚无确定配方");
        const lines = await tx.recipeLine.findMany({
          where: { versionId: orderItem.recipeVersionId },
          include: { material: true },
        });
        if (lines.some((line) => line.material.tenantId !== order.tenantId)) {
          throw new Error("Recipe line material belongs to another tenant");
        }
        requirements = expandRecipe(lines.map((line) => ({
          materialId: line.materialId,
          perUnitQuantity: Number(line.plannedQty),
          expectedLossRate: Number(line.expectedLossRate),
          reservePerOrder: line.material.reservePerOrder,
          quantityScale: line.material.quantityScale,
        })), quantity, input.deliveryAt).sort((left, right) => left.materialId.localeCompare(right.materialId));
      }
      plans.push({ orderItem, quantity, requirements });
    }

    // Release only this order's latest active holds. Another order's or sample's reservations,
    // and this order's historical reservations, stay untouched.
    const orderRequirementIds = order.items
      .flatMap((item) => item.requirements)
      .filter((requirement) => requirement.revisionId === latestRevision.id)
      .map((requirement) => requirement.id);
    if (orderRequirementIds.length > 0) {
      await tx.inventoryReservation.updateMany({
        where: { requirementId: { in: orderRequirementIds }, state: ReservationState.ACTIVE },
        data: { state: ReservationState.RELEASED },
      });
    }

    const revision = await tx.orderRevision.create({
      data: { orderId: order.id, number: revisionNumber, reason: "修改订单数量与交付时间" },
    });
    let totalShortage = 0;
    for (const plan of plans) {
      for (const requirement of plan.requirements) {
        const stored = await tx.orderMaterialRequirement.create({
          data: {
            orderItemId: plan.orderItem.id,
            revisionId: revision.id,
            materialId: requirement.materialId,
            plannedQty: requirement.quantity,
            needBy: requirement.needBy,
          },
        });
        const allocation = await reserveOrderMaterial(tx, stored.id);
        totalShortage += allocation.shortage;
      }
    }

    const covered = totalShortage <= 1e-8;
    const taskState = covered ? ProductionState.READY : ProductionState.WAITING_MATERIAL;
    for (const plan of plans) {
      if (plan.orderItem.tasks.length === 0) {
        await tx.productionTask.create({
          data: { orderItemId: plan.orderItem.id, quantity: plan.quantity, state: taskState },
        });
      } else {
        await tx.productionTask.updateMany({
          where: { orderItemId: plan.orderItem.id },
          data: { quantity: plan.quantity, state: taskState },
        });
      }
      await tx.orderItem.update({ where: { id: plan.orderItem.id }, data: { quantity: plan.quantity } });
    }
    await tx.order.update({
      where: { id: order.id },
      data: {
        deliveryAt: input.deliveryAt,
        version: revisionNumber,
        commercialState: covered ? CommercialState.CONFIRMED : CommercialState.PENDING_CONFIRMATION,
        supplyState: covered ? SupplyState.ON_HAND_COVERED : SupplyState.PURCHASE_REQUIRED,
        productionState: covered ? ProductionState.READY : ProductionState.WAITING_MATERIAL,
      },
    });
    await tx.fulfillment.updateMany({
      where: { orderId: order.id },
      data: { scheduledAt: input.deliveryAt },
    });

    return {
      orderId: order.id,
      revisionId: revision.id,
      revisionNumber,
      covered,
      totalShortage,
    };
  }, { timeout: 30_000 });
}
