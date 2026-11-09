import {
  CommercialState, DeliveryAttemptState, FulfillmentKind, FulfillmentState,
  Prisma, ProductionState, type PrismaClient,
} from "../../generated/prisma-v2/client";

export type CreateDeliveryAttemptInput = {
  tenantId: string;
  storeId: string;
  orderId: string;
  actorStaffId: string;
  scheduledAt?: Date | null;
  note?: string | null;
};

export type DeliveryAttemptActionResult = {
  orderId: string;
  attemptId: string;
  attemptNo: number;
  state: string;
  rescheduled: boolean;
};

const IN_PROGRESS_STATES: readonly DeliveryAttemptState[] = [
  DeliveryAttemptState.SCHEDULED,
  DeliveryAttemptState.OUT_FOR_DELIVERY,
];

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}不能为空`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label}不能为空`);
  return trimmed;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label}格式无效`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `undefined` means "leave the stored schedule untouched"; null clears it. */
function optionalDate(value: unknown, label: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label}无效`);
  }
  return value;
}

function futureDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("新的配送时间无效");
  }
  if (value.getTime() <= Date.now()) throw new Error("新的配送时间必须晚于当前时间");
  return value;
}

function isInProgress(state: DeliveryAttemptState): boolean {
  return IN_PROGRESS_STATES.includes(state);
}

async function lockAndLoadOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  tenantId: string,
  storeId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      fulfillment: {
        include: { attempts: { orderBy: { attemptNo: "asc" } } },
      },
    },
  });
  // Cross-tenant and cross-store ids fail with the exact same message as a missing order.
  if (!order || order.tenantId !== tenantId || order.storeId !== storeId) {
    throw new Error("订单不存在");
  }
  return order;
}

function requireDeliveryFulfillment(order: {
  fulfillment: {
    kind: FulfillmentKind;
    id: string;
    attempts: {
      id: string;
      attemptNo: number;
      state: DeliveryAttemptState;
      failureReason: string | null;
    }[];
  } | null;
}) {
  if (!order.fulfillment) throw new Error("缺少交付方式");
  if (order.fulfillment.kind !== FulfillmentKind.DELIVERY) {
    throw new Error("仅配送订单支持配送尝试");
  }
  return order.fulfillment;
}

function nextAttemptNo(attempts: readonly { attemptNo: number }[]): number {
  return attempts.reduce((max, attempt) => Math.max(max, attempt.attemptNo), 0) + 1;
}

function result(
  orderId: string,
  attempt: { id: string; attemptNo: number; state: DeliveryAttemptState | string },
  rescheduled: boolean,
): DeliveryAttemptActionResult {
  return {
    orderId,
    attemptId: attempt.id,
    attemptNo: attempt.attemptNo,
    state: attempt.state,
    rescheduled,
  };
}

/**
 * Creates the first delivery attempt. A failed attempt is deliberately not replaced here: the
 * operator has to acknowledge the failure through `rescheduleDeliveryAttempt`.
 */
export async function createDeliveryAttempt(
  db: PrismaClient,
  input: CreateDeliveryAttemptInput,
): Promise<DeliveryAttemptActionResult> {
  const tenantId = requiredText(input.tenantId, "租户");
  const storeId = requiredText(input.storeId, "门店");
  const orderId = requiredText(input.orderId, "订单");
  const actorStaffId = requiredText(input.actorStaffId, "操作人");
  const note = optionalText(input.note, "备注");
  const scheduledAt = optionalDate(input.scheduledAt, "配送时间");

  return db.$transaction(async (tx) => {
    const order = await lockAndLoadOrder(tx, orderId, tenantId, storeId);
    const fulfillment = requireDeliveryFulfillment(order);

    if (order.commercialState === CommercialState.CANCELLED
        || order.commercialState === CommercialState.CLOSED
        || order.fulfillmentState === FulfillmentState.DELIVERED) {
      throw new Error("订单当前不能创建配送尝试");
    }
    if (order.productionState !== ProductionState.COMPLETED) {
      throw new Error("订单尚未完成制作");
    }
    if (fulfillment.attempts.some((attempt) => isInProgress(attempt.state))) {
      throw new Error("已有进行中的配送尝试");
    }
    if (order.fulfillmentState !== FulfillmentState.WAITING_DELIVERY) {
      throw new Error("订单当前不能创建配送尝试");
    }

    const attemptNo = nextAttemptNo(fulfillment.attempts);
    const attempt = await tx.deliveryAttempt.create({
      data: {
        fulfillmentId: fulfillment.id,
        attemptNo,
        state: DeliveryAttemptState.SCHEDULED,
      },
    });
    if (scheduledAt !== undefined) {
      await tx.fulfillment.update({
        where: { id: fulfillment.id },
        data: { scheduledAt },
      });
    }

    await tx.auditEvent.create({
      data: {
        tenantId,
        storeId,
        actorStaffId,
        action: "DELIVERY_ATTEMPT_CREATED",
        entityType: "DeliveryAttempt",
        entityId: attempt.id,
        afterSnapshot: {
          orderId,
          attemptNo,
          state: attempt.state,
          scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
          note,
        },
      },
    });
    return result(orderId, attempt, false);
  }, { timeout: 30_000 });
}

/** The courier leaves the store with the order. */
export async function startDeliveryAttempt(
  db: PrismaClient,
  input: {
    tenantId: string;
    storeId: string;
    orderId: string;
    attemptId: string;
    actorStaffId: string;
  },
): Promise<DeliveryAttemptActionResult> {
  const tenantId = requiredText(input.tenantId, "租户");
  const storeId = requiredText(input.storeId, "门店");
  const orderId = requiredText(input.orderId, "订单");
  const attemptId = requiredText(input.attemptId, "配送尝试");
  const actorStaffId = requiredText(input.actorStaffId, "操作人");

  return db.$transaction(async (tx) => {
    const order = await lockAndLoadOrder(tx, orderId, tenantId, storeId);
    const fulfillment = requireDeliveryFulfillment(order);
    if (order.fulfillmentState !== FulfillmentState.WAITING_DELIVERY) {
      throw new Error("订单当前不能开始配送");
    }
    const attempt = fulfillment.attempts.find((row) => row.id === attemptId);
    if (!attempt) throw new Error("配送尝试不存在");
    if (attempt.state !== DeliveryAttemptState.SCHEDULED) {
      throw new Error("配送尝试当前状态不能开始配送");
    }

    const departedAt = new Date();
    const updated = await tx.deliveryAttempt.update({
      where: { id: attempt.id },
      data: { state: DeliveryAttemptState.OUT_FOR_DELIVERY, departedAt },
    });
    await tx.order.update({
      where: { id: orderId },
      data: { fulfillmentState: FulfillmentState.DELIVERING },
    });
    await tx.auditEvent.create({
      data: {
        tenantId,
        storeId,
        actorStaffId,
        action: "DELIVERY_ATTEMPT_STARTED",
        entityType: "DeliveryAttempt",
        entityId: attempt.id,
        afterSnapshot: {
          orderId,
          attemptNo: updated.attemptNo,
          state: updated.state,
          departedAt: departedAt.toISOString(),
        },
      },
    });
    return result(orderId, updated, false);
  }, { timeout: 30_000 });
}

/**
 * Marks the current attempt as failed. It intentionally does not create the next attempt: a
 * failure must be reviewed and an operator must explicitly reschedule it.
 */
export async function failDeliveryAttempt(
  db: PrismaClient,
  input: {
    tenantId: string;
    storeId: string;
    orderId: string;
    attemptId: string;
    actorStaffId: string;
    reason: string;
  },
): Promise<DeliveryAttemptActionResult> {
  const tenantId = requiredText(input.tenantId, "租户");
  const storeId = requiredText(input.storeId, "门店");
  const orderId = requiredText(input.orderId, "订单");
  const attemptId = requiredText(input.attemptId, "配送尝试");
  const actorStaffId = requiredText(input.actorStaffId, "操作人");
  const reason = requiredText(input.reason, "失败原因");

  return db.$transaction(async (tx) => {
    const order = await lockAndLoadOrder(tx, orderId, tenantId, storeId);
    const fulfillment = requireDeliveryFulfillment(order);
    if (order.fulfillmentState !== FulfillmentState.DELIVERING) {
      throw new Error("订单当前不在配送中");
    }
    const attempt = fulfillment.attempts.find((row) => row.id === attemptId);
    if (!attempt) throw new Error("配送尝试不存在");
    if (attempt.state !== DeliveryAttemptState.OUT_FOR_DELIVERY) {
      throw new Error("配送尝试当前状态不能确认失败");
    }

    const completedAt = new Date();
    const updated = await tx.deliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        state: DeliveryAttemptState.FAILED,
        completedAt,
        failureReason: reason,
      },
    });
    await tx.order.update({
      where: { id: orderId },
      data: { fulfillmentState: FulfillmentState.FAILED },
    });
    await tx.auditEvent.create({
      data: {
        tenantId,
        storeId,
        actorStaffId,
        action: "DELIVERY_ATTEMPT_FAILED",
        entityType: "DeliveryAttempt",
        entityId: attempt.id,
        afterSnapshot: {
          orderId,
          attemptNo: updated.attemptNo,
          state: updated.state,
          failureReason: reason,
          completedAt: completedAt.toISOString(),
        },
      },
    });
    return result(orderId, updated, false);
  }, { timeout: 30_000 });
}

/**
 * Creates the next attempt after a failed one. The latest attempt must already be FAILED, so an
 * operator cannot skip failure acknowledgement by scheduling over an in-flight delivery.
 */
export async function rescheduleDeliveryAttempt(
  db: PrismaClient,
  input: {
    tenantId: string;
    storeId: string;
    orderId: string;
    actorStaffId: string;
    scheduledAt: Date;
    note?: string | null;
  },
): Promise<DeliveryAttemptActionResult> {
  const tenantId = requiredText(input.tenantId, "租户");
  const storeId = requiredText(input.storeId, "门店");
  const orderId = requiredText(input.orderId, "订单");
  const actorStaffId = requiredText(input.actorStaffId, "操作人");
  const scheduledAt = futureDate(input.scheduledAt);
  const note = optionalText(input.note, "备注");

  return db.$transaction(async (tx) => {
    const order = await lockAndLoadOrder(tx, orderId, tenantId, storeId);
    const fulfillment = requireDeliveryFulfillment(order);
    const latest = fulfillment.attempts[fulfillment.attempts.length - 1];
    if (!latest || latest.state !== DeliveryAttemptState.FAILED) {
      throw new Error("最近一次配送尝试尚未确认失败，不能重排");
    }
    if (fulfillment.attempts.some((attempt) => isInProgress(attempt.state))) {
      throw new Error("已有进行中的配送尝试");
    }
    if (order.fulfillmentState !== FulfillmentState.FAILED) {
      throw new Error("订单当前不能重排配送");
    }

    const attemptNo = nextAttemptNo(fulfillment.attempts);
    const attempt = await tx.deliveryAttempt.create({
      data: {
        fulfillmentId: fulfillment.id,
        attemptNo,
        state: DeliveryAttemptState.SCHEDULED,
      },
    });
    await tx.fulfillment.update({
      where: { id: fulfillment.id },
      data: { scheduledAt },
    });
    await tx.order.update({
      where: { id: orderId },
      data: { fulfillmentState: FulfillmentState.WAITING_DELIVERY },
    });
    await tx.auditEvent.create({
      data: {
        tenantId,
        storeId,
        actorStaffId,
        action: "DELIVERY_ATTEMPT_RESCHEDULED",
        entityType: "DeliveryAttempt",
        entityId: attempt.id,
        afterSnapshot: {
          orderId,
          previousAttemptNo: latest.attemptNo,
          previousFailureReason: latest.failureReason,
          attemptNo,
          state: attempt.state,
          scheduledAt: scheduledAt.toISOString(),
          note,
        },
      },
    });
    return result(orderId, attempt, true);
  }, { timeout: 30_000 });
}
