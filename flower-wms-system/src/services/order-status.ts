import { OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/** 管理后台 API 使用的履约阶段（与 Prisma 枚举映射） */
export type FulfillmentPhase =
  | "PENDING_PAY"
  | "PAID"
  | "MAKING"
  | "DELIVERING"
  | "COMPLETED"
  | "CANCELLED";

const REMARK_DELIVERING = "FULFILLMENT:DELIVERING";

const NEXT_STATUS_INPUTS: Record<FulfillmentPhase, FulfillmentPhase[]> = {
  PENDING_PAY: ["PAID", "CANCELLED"],
  PAID: ["MAKING"],
  MAKING: ["DELIVERING"],
  DELIVERING: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function parseNextStatusInput(raw: string): FulfillmentPhase | null {
  const key = raw.trim().toUpperCase();
  const alias: Record<string, FulfillmentPhase> = {
    PENDING: "PENDING_PAY",
    PENDING_PAY: "PENDING_PAY",
    PAID: "PAID",
    MAKING: "MAKING",
    PREPARING: "MAKING",
    DELIVERING: "DELIVERING",
    DELIVERED: "COMPLETED",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
  };
  return alias[key] ?? null;
}

export function getFulfillmentPhase(order: {
  status: OrderStatus;
  remark: string | null;
}): FulfillmentPhase {
  if (order.status === OrderStatus.PENDING) return "PENDING_PAY";
  if (order.status === OrderStatus.PAID) return "PAID";
  if (order.status === OrderStatus.PREPARING) {
    return order.remark === REMARK_DELIVERING ? "DELIVERING" : "MAKING";
  }
  if (order.status === OrderStatus.DELIVERED) return "COMPLETED";
  return "CANCELLED";
}

export function canTransition(
  current: FulfillmentPhase,
  next: FulfillmentPhase
): boolean {
  return NEXT_STATUS_INPUTS[current]?.includes(next) ?? false;
}

export async function transitionOrderStatus(
  orderId: string,
  nextStatusInput: string
) {
  const nextPhase = parseNextStatusInput(nextStatusInput);
  if (!nextPhase) {
    throw new Error(
      `无效的目标状态：${nextStatusInput}。允许：MAKING、DELIVERING、COMPLETED、PAID、CANCELLED 等`
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error("订单不存在");
  }

  const currentPhase = getFulfillmentPhase(order);

  if (!canTransition(currentPhase, nextPhase)) {
    throw new Error(
      `状态流转不合法：当前为「${currentPhase}」，不可变更为「${nextPhase}」`
    );
  }

  let data: {
    status: OrderStatus;
    remark?: string | null;
    paidAt?: Date;
    deliveredAt?: Date;
  };

  switch (nextPhase) {
    case "PAID":
      data = {
        status: OrderStatus.PAID,
        remark: order.remark === REMARK_DELIVERING ? null : order.remark,
        paidAt: order.paidAt ?? new Date(),
      };
      break;
    case "MAKING":
      data = { status: OrderStatus.PREPARING, remark: null };
      break;
    case "DELIVERING":
      data = { status: OrderStatus.PREPARING, remark: REMARK_DELIVERING };
      break;
    case "COMPLETED":
      data = {
        status: OrderStatus.DELIVERED,
        remark: null,
        deliveredAt: order.deliveredAt ?? new Date(),
      };
      break;
    case "CANCELLED":
      data = { status: OrderStatus.CANCELLED, remark: order.remark };
      break;
    default:
      throw new Error(`不支持的目标状态：${nextPhase}`);
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data,
    select: {
      id: true,
      orderNo: true,
      status: true,
      remark: true,
      paidAt: true,
      deliveredAt: true,
      updatedAt: true,
    },
  });

  return {
    order: updated,
    status: getFulfillmentPhase(updated),
    dbStatus: updated.status,
  };
}
