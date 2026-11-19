import {
  CommercialState, FulfillmentState, HoldState, ProductionState, RefundState,
  ReservationState, SupplyState, type PrismaClient,
} from "../../generated/prisma-v2/client";

export type CancelOrderInput = {
  tenantId: string;
  storeId: string;
  orderId: string;
  actorStaffId: string;
  reason?: string | null;
};

export type CancelOrderResult = {
  orderId: string;
  cancelled: boolean;
  alreadyCancelled: boolean;
  releasedHoldCount: number;
  releasedReservationCount: number;
};

export type CloseOrderInput = {
  tenantId: string;
  storeId: string;
  orderId: string;
  actorStaffId: string;
  reason?: string | null;
};

export type CloseOrderResult = {
  orderId: string;
  closed: boolean;
  alreadyClosed: boolean;
};

export type StartOrderProductionInput = {
  tenantId: string;
  storeId: string;
  orderId: string;
  actorStaffId: string;
};

export type StartOrderProductionResult = {
  orderId: string;
  started: boolean;
  alreadyStarted: boolean;
};

/**
 * Production states that mean work has already begun (or ended abnormally). Cancelling an order
 * in any of them would destroy production/cost facts, so it is refused.
 */
const STARTED_PRODUCTION_STATES: readonly ProductionState[] = [
  ProductionState.IN_PROGRESS,
  ProductionState.COMPLETED,
  ProductionState.EXCEPTION,
];

function requireActor(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("缺少操作员工信息");
  }
  return value.trim();
}

function normalizeReason(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("操作原因格式无效");
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Cancels an order that has not been fulfilled or produced.
 *
 * The order row is locked first so cancellation serializes with confirmation, revision,
 * production completion and delivery writers. Only this order's ACTIVE availability holds and
 * the ACTIVE reservations under this order's own material requirements are released. Other
 * orders' and samples' reservations are untouched, and no inventory quantity is ever changed.
 * A repeated cancellation is an idempotent read: it writes no audit event and releases nothing.
 */
export async function cancelOrder(
  db: PrismaClient,
  input: CancelOrderInput,
): Promise<CancelOrderResult> {
  const actorStaffId = requireActor(input.actorStaffId);
  const reason = normalizeReason(input.reason);

  return db.$transaction(async (tx) => {
    // Order-first lock order is shared with confirm/revise/reserve/production/delivery writers.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: {
          select: {
            requirements: { select: { id: true } },
            tasks: { select: { state: true, startedAt: true, completedAt: true } },
          },
        },
        fulfillment: { select: { handedOverAt: true } },
        refunds: { select: { state: true } },
      },
    });
    // Non-disclosing: cross-tenant, cross-store and nonexistent orders fail identically.
    if (!order || order.tenantId !== input.tenantId || order.storeId !== input.storeId) {
      throw new Error("订单不存在");
    }
    if (order.commercialState === CommercialState.CANCELLED) {
      return {
        orderId: order.id,
        cancelled: false,
        alreadyCancelled: true,
        releasedHoldCount: 0,
        releasedReservationCount: 0,
      };
    }
    if (order.commercialState === CommercialState.CLOSED) {
      throw new Error("订单已关闭，不能取消");
    }
    if (order.fulfillmentState === FulfillmentState.DELIVERED || order.fulfillment?.handedOverAt) {
      throw new Error("订单已交付，不能取消");
    }
    const productionStarted = STARTED_PRODUCTION_STATES.includes(order.productionState)
      || order.items.some((item) => item.tasks.some((task) =>
        task.startedAt !== null
        || task.completedAt !== null
        || STARTED_PRODUCTION_STATES.includes(task.state)));
    if (productionStarted) {
      throw new Error("订单已开始制作，不能取消");
    }
    if (order.refunds.some((refund) => refund.state === RefundState.REQUESTED)) {
      throw new Error("订单存在未完成的退款，不能取消");
    }

    const requirementIds = order.items.flatMap((item) =>
      item.requirements.map((requirement) => requirement.id));

    const releasedHolds = await tx.availabilityHold.updateMany({
      where: { orderId: order.id, state: HoldState.ACTIVE },
      data: { state: HoldState.RELEASED },
    });
    const releasedReservations = requirementIds.length === 0
      ? { count: 0 }
      : await tx.inventoryReservation.updateMany({
        where: {
          requirementId: { in: requirementIds },
          state: ReservationState.ACTIVE,
        },
        data: { state: ReservationState.RELEASED },
      });

    await tx.order.update({
      where: { id: order.id },
      data: { commercialState: CommercialState.CANCELLED },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: order.tenantId,
        storeId: order.storeId,
        actorStaffId,
        action: "ORDER_CANCELLED",
        entityType: "Order",
        entityId: order.id,
        beforeSnapshot: {
          orderId: order.id,
          commercialState: order.commercialState,
          supplyState: order.supplyState,
          productionState: order.productionState,
          fulfillmentState: order.fulfillmentState,
          deliveredAt: order.fulfillment?.handedOverAt?.toISOString() ?? null,
        },
        afterSnapshot: {
          orderId: order.id,
          commercialState: CommercialState.CANCELLED,
          previousCommercialState: order.commercialState,
          reason,
          releasedHoldCount: releasedHolds.count,
          releasedReservationCount: releasedReservations.count,
        },
      },
    });

    return {
      orderId: order.id,
      cancelled: true,
      alreadyCancelled: false,
      releasedHoldCount: releasedHolds.count,
      releasedReservationCount: releasedReservations.count,
    };
  }, { timeout: 30_000 });
}

/**
 * Closes a delivered order. The delivery facts, cost snapshot, reservations and production
 * history are never rewritten here; only the commercial state and an audit event change.
 * Repeating a close is idempotent and does not append another audit event.
 */
export async function closeOrder(
  db: PrismaClient,
  input: CloseOrderInput,
): Promise<CloseOrderResult> {
  const actorStaffId = requireActor(input.actorStaffId);
  const reason = normalizeReason(input.reason);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        fulfillment: { select: { handedOverAt: true } },
        refunds: { select: { state: true } },
      },
    });
    if (!order || order.tenantId !== input.tenantId || order.storeId !== input.storeId) {
      throw new Error("订单不存在");
    }
    if (order.commercialState === CommercialState.CLOSED) {
      return { orderId: order.id, closed: false, alreadyClosed: true };
    }
    if (order.commercialState === CommercialState.CANCELLED) {
      throw new Error("订单已取消，不能关闭");
    }
    if (order.fulfillmentState !== FulfillmentState.DELIVERED && !order.fulfillment?.handedOverAt) {
      throw new Error("只有已交付订单才能关闭");
    }
    if (order.refunds.some((refund) => refund.state === RefundState.REQUESTED)) {
      throw new Error("订单存在未完成的退款，不能关闭");
    }

    await tx.order.update({
      where: { id: order.id },
      data: { commercialState: CommercialState.CLOSED },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: order.tenantId,
        storeId: order.storeId,
        actorStaffId,
        action: "ORDER_CLOSED",
        entityType: "Order",
        entityId: order.id,
        beforeSnapshot: {
          orderId: order.id,
          commercialState: order.commercialState,
          fulfillmentState: order.fulfillmentState,
          deliveredAt: order.fulfillment?.handedOverAt?.toISOString() ?? null,
        },
        afterSnapshot: {
          orderId: order.id,
          commercialState: CommercialState.CLOSED,
          previousCommercialState: order.commercialState,
          reason,
        },
      },
    });

    return { orderId: order.id, closed: true, alreadyClosed: false };
  }, { timeout: 30_000 });
}

/**
 * Starts order production once the order is confirmed, fully covered by on-hand stock and READY.
 *
 * A missing assignee is not a blocker: the task can be picked up by any staff member. Every READY
 * task is moved to IN_PROGRESS with the same startedAt. Repeating the call while already
 * IN_PROGRESS is idempotent and does not append another audit event.
 */
export async function startOrderProduction(
  db: PrismaClient,
  input: StartOrderProductionInput,
): Promise<StartOrderProductionResult> {
  const actorStaffId = requireActor(input.actorStaffId);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: {
          select: {
            tasks: { select: { state: true, startedAt: true } },
          },
        },
      },
    });
    if (!order || order.tenantId !== input.tenantId || order.storeId !== input.storeId) {
      throw new Error("订单不存在");
    }
    if (order.productionState === ProductionState.IN_PROGRESS) {
      return { orderId: order.id, started: false, alreadyStarted: true };
    }
    if (order.productionState === ProductionState.COMPLETED) {
      throw new Error("订单制作已完成，不能重复开始");
    }
    if (order.productionState === ProductionState.EXCEPTION) {
      throw new Error("订单制作状态异常，不能开始制作");
    }

    const tasks = order.items.flatMap((item) => item.tasks);
    if (tasks.some((task) => task.state === ProductionState.COMPLETED)) {
      throw new Error("订单制作已完成，不能重复开始");
    }
    if (tasks.some((task) => task.state === ProductionState.EXCEPTION)) {
      throw new Error("订单制作状态异常，不能开始制作");
    }
    if (tasks.some((task) => task.startedAt !== null)) {
      throw new Error("订单已开始制作，不能重复开始");
    }

    if (order.commercialState === CommercialState.CANCELLED) {
      throw new Error("订单已取消，不能开始制作");
    }
    if (order.commercialState === CommercialState.CLOSED) {
      throw new Error("订单已关闭，不能开始制作");
    }
    if (order.commercialState !== CommercialState.CONFIRMED) {
      throw new Error("订单尚未确认，不能开始制作");
    }
    if (order.supplyState !== SupplyState.ON_HAND_COVERED) {
      throw new Error("订单物料尚未备齐，不能开始制作");
    }
    if (order.productionState !== ProductionState.READY) {
      throw new Error("订单尚未就绪，不能开始制作");
    }

    const startedAt = new Date();
    const startedTasks = await tx.productionTask.updateMany({
      where: {
        orderItem: { orderId: order.id },
        state: ProductionState.READY,
      },
      data: { state: ProductionState.IN_PROGRESS, startedAt },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { productionState: ProductionState.IN_PROGRESS },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: order.tenantId,
        storeId: order.storeId,
        actorStaffId,
        action: "ORDER_PRODUCTION_STARTED",
        entityType: "Order",
        entityId: order.id,
        beforeSnapshot: {
          orderId: order.id,
          commercialState: order.commercialState,
          supplyState: order.supplyState,
          productionState: order.productionState,
          taskCount: tasks.length,
          readyTaskCount: tasks.filter((task) => task.state === ProductionState.READY).length,
        },
        afterSnapshot: {
          orderId: order.id,
          productionState: ProductionState.IN_PROGRESS,
          previousProductionState: order.productionState,
          startedTaskCount: startedTasks.count,
          startedAt: startedAt.toISOString(),
        },
      },
    });

    return { orderId: order.id, started: true, alreadyStarted: false };
  }, { timeout: 30_000 });
}
