import { Prisma } from "@/generated/prisma/client";
import { OrderCancelSource, OrderStatus } from "@/generated/prisma/enums";
import {
  MINIPROGRAM_ERROR_CODES,
  MiniprogramBusinessError,
  isMiniprogramBusinessError,
} from "@/lib/miniprogram-business-error";
import { prisma } from "@/lib/prisma";
import {
  markOrderPaidWithFifo,
  restorePhysicalStockFromSaleOutInTx,
} from "@/services/order-fifo";
import {
  assertOrderStockAvailable,
  assertSellableSpu,
  formatInsufficientStockMessage,
  mergeOrderLineQuantities,
} from "@/services/miniprogram-stock-pure";
import {
  evaluateBulkPreorderRequirement,
  formatBulkPreorderServerMessage,
  resolveSkuPreorderRule,
} from "@/services/preorder-rule-pure";
import { evaluateDeliveryAvailability } from "@/services/delivery-settings-pure";
import {
  isPendingPaymentExpired,
  PENDING_PAYMENT_TIMEOUT_MS,
} from "@/services/order-invariants-pure";
import { getStoreDeliverySettings } from "@/services/store-delivery-settings";
import {
  resolveDeliveryTimeForValidation,
  toDeliverySettingsInput,
} from "@/lib/store-delivery-settings";

export const STOCK_SOLD_OUT_MESSAGE = "手慢了，花材库存已被抢光！";

export const FREE_SHIPPING_THRESHOLD = 99;
export const DEFAULT_DELIVERY_FEE = 15;

export { PENDING_PAYMENT_TIMEOUT_MS };

export type CreateOrderLineInput = {
  skuId: string;
  quantity: number;
};

export type CreateWechatOrderPayload = {
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  deliveryDate: string;
  greetingCard?: string;
  totalAmount: number;
  deliveryFee: number;
  payAmount: number;
  items: CreateOrderLineInput[];
};

/** ORD-yyyyMMdd-随机流水 */
export function generateWechatOrderNo(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${date}-${suffix}`;
}

export function calcDeliveryFee(productTotal: number): number {
  return productTotal >= FREE_SHIPPING_THRESHOLD ? 0 : DEFAULT_DELIVERY_FEE;
}

/** 待支付订单支付截止时间 */
export function computeOrderPaymentExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PENDING_PAYMENT_TIMEOUT_MS);
}

/** 创建订单前校验配送日期 / 时段（Asia/Shanghai） */
export async function assertDeliveryAvailabilityForOrder(
  deliveryDate: string,
  now: Date = new Date()
): Promise<void> {
  const storeSettings = await getStoreDeliverySettings();
  const result = evaluateDeliveryAvailability({
    deliveryDate,
    deliveryTime: resolveDeliveryTimeForValidation(deliveryDate),
    now,
    settings: toDeliverySettingsInput(storeSettings),
  });

  if (!result.allowed) {
    const code =
      result.code === MINIPROGRAM_ERROR_CODES.DELIVERY_SLOT_UNAVAILABLE
        ? MINIPROGRAM_ERROR_CODES.DELIVERY_SLOT_UNAVAILABLE
        : MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE;
    throw new MiniprogramBusinessError(
      code,
      result.message ?? "请选择有效配送日期"
    );
  }
}

function roundMoney(n: number): number {
  return Number(n.toFixed(2));
}

export function isStockSoldOutError(err: unknown): boolean {
  if (
    isMiniprogramBusinessError(err) &&
    err.code === MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK
  ) {
    return true;
  }
  return err instanceof Error && err.message === STOCK_SOLD_OUT_MESSAGE;
}

/** 事务内将订单行对应 SKU 库存归还 */
export async function restoreOrderSkuStock(
  tx: Prisma.TransactionClient,
  orderId: string
) {
  const lines = await tx.orderItem.findMany({
    where: { orderId },
    select: { skuId: true, quantity: true },
  });

  for (const line of lines) {
    await tx.productSku.update({
      where: { id: line.skuId },
      data: { stock: { increment: line.quantity } },
    });
  }
}

/**
 * 原子扣减 SKU 库存（禁止先查后改）；影响行数为 0 则熔断超卖。
 */
async function atomicDecrementSkuStock(
  tx: Prisma.TransactionClient,
  skuId: string,
  quantity: number,
  specName: string
) {
  const result = await tx.productSku.updateMany({
    where: {
      id: skuId,
      stock: { gte: quantity },
      spu: {
        isDeleted: false,
        isActive: true,
      },
    },
    data: { stock: { decrement: quantity } },
  });

  if (result.count !== 1) {
    const current = await tx.productSku.findUnique({
      where: { id: skuId },
      select: { stock: true, specName: true },
    });
    const available = current?.stock ?? 0;
    throw new MiniprogramBusinessError(
      MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK,
      formatInsufficientStockMessage(
        current?.specName ?? specName,
        available
      )
    );
  }
}

/**
 * 创建待支付订单：Serializable 事务 + 原子锁库存 + 快照落库。
 */
export async function createWechatOrder(
  userId: string,
  payload: CreateWechatOrderPayload
) {
  const orderNo = generateWechatOrderNo();
  const expectedPay = roundMoney(payload.totalAmount + payload.deliveryFee);

  if (Math.abs(expectedPay - payload.payAmount) > 0.01) {
    throw new Error("实付金额与商品总额加运费不一致");
  }

  if (!payload.deliveryDate.trim()) {
    throw new Error("请选择配送时间");
  }

  if (!payload.items.length) {
    throw new Error("结算商品不能为空");
  }

  await assertDeliveryAvailabilityForOrder(payload.deliveryDate);

  return prisma.$transaction(
    async (tx) => {
      const skuIds = [...new Set(payload.items.map((i) => i.skuId))];
      const skus = await tx.productSku.findMany({
        where: { id: { in: skuIds } },
        include: {
          spu: {
            select: {
              id: true,
              name: true,
              isActive: true,
              isDeleted: true,
            },
          },
        },
      });
      const skuMap = new Map(skus.map((s) => [s.id, s]));

      const mergedQty = mergeOrderLineQuantities(payload.items);

      let linesTotal = 0;

      for (const line of payload.items) {
        const sku = skuMap.get(line.skuId);
        if (!sku) {
          throw new MiniprogramBusinessError(
            MINIPROGRAM_ERROR_CODES.SKU_NOT_FOUND,
            `商品款式不存在: ${line.skuId}`
          );
        }
        const spu = sku.spu;
        if (!spu) {
          throw new MiniprogramBusinessError(
            MINIPROGRAM_ERROR_CODES.PRODUCT_NOT_FOUND,
            "商品不存在"
          );
        }
        assertSellableSpu(spu);
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
          throw new Error("商品数量无效");
        }
        linesTotal += Number(sku.price) * line.quantity;
      }

      for (const [skuId, requestedQty] of mergedQty) {
        const sku = skuMap.get(skuId);
        if (!sku) continue;
        assertOrderStockAvailable({
          specName: sku.specName,
          stock: sku.stock,
          requestedQty,
        });
      }

      const preorderItems = [...mergedQty.entries()].map(([skuId, quantity]) => {
        const sku = skuMap.get(skuId)!;
        const spu = sku.spu!;
        return {
          skuId,
          productName: spu.name,
          skuName: sku.specName,
          quantity,
          preorderRule: resolveSkuPreorderRule({ skuRule: sku }),
        };
      });

      const preorderCheck = evaluateBulkPreorderRequirement({
        items: preorderItems,
        deliveryDate: payload.deliveryDate,
      });

      if (!preorderCheck.allowed) {
        const earliest =
          preorderCheck.earliestDeliveryDate ??
          preorderCheck.violations[0]?.earliestDeliveryDate ??
          "";
        throw new MiniprogramBusinessError(
          MINIPROGRAM_ERROR_CODES.BULK_ORDER_REQUIRES_PREORDER,
          earliest
            ? formatBulkPreorderServerMessage(earliest)
            : "当前订单数量较多，需要提前预订，请重新选择配送日期。"
        );
      }

      linesTotal = roundMoney(linesTotal);
      if (Math.abs(linesTotal - payload.totalAmount) > 0.01) {
        throw new Error(
          `商品总额不一致：明细合计 ${linesTotal.toFixed(2)}，提交 ${payload.totalAmount.toFixed(2)}`
        );
      }

      for (const [skuId, requestedQty] of mergedQty) {
        const sku = skuMap.get(skuId)!;
        await atomicDecrementSkuStock(tx, skuId, requestedQty, sku.specName);
      }

      const order = await tx.order.create({
        data: {
          orderNo,
          userId,
          totalAmount: payload.totalAmount,
          deliveryFee: payload.deliveryFee,
          payAmount: payload.payAmount,
          receiverName: payload.receiverName,
          receiverPhone: payload.receiverPhone,
          deliveryAddress: payload.deliveryAddress,
          deliveryDate: payload.deliveryDate.trim(),
          greetingCard: payload.greetingCard?.trim() || null,
          status: OrderStatus.PENDING_PAYMENT,
        },
      });

      for (const line of payload.items) {
        const sku = skuMap.get(line.skuId)!;
        const spu = sku.spu!;

        await tx.orderItem.create({
          data: {
            orderId: order.id,
            skuId: sku.id,
            quantity: line.quantity,
            snapshotProductName: spu.name,
            snapshotSpecName: sku.specName,
            snapshotPrice: Number(sku.price),
            snapshotImageUrl: sku.imageUrl ?? "",
          },
        });
      }

      return order;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 30000,
    }
  );
}

/** 模拟支付：待支付 → 已支付，同事务 FIFO 扣减物理批次 */
export async function mockPayWechatOrder(userId: string, orderId: string) {
  return markOrderPaidWithFifo({ orderId, userId, operator: "mock-pay" });
}

/** 用户确认收货：仅配送中可完成 */
export async function confirmWechatOrderReceipt(userId: string, orderId: string) {
  const updated = await prisma.order.updateMany({
    where: {
      id: orderId,
      userId,
      status: OrderStatus.DELIVERING,
    },
    data: { status: OrderStatus.COMPLETED },
  });

  if (updated.count !== 1) {
    throw new Error("仅配送中的订单可确认收货");
  }

  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
}

/** 批量关闭超时待支付订单（15 分钟），回补 ProductSku.stock */
export async function closeExpiredPendingOrders(now: Date = new Date()) {
  const pending = await prisma.order.findMany({
    where: { status: OrderStatus.PENDING_PAYMENT },
    select: { id: true, orderNo: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const expired = pending.filter((order) =>
    isPendingPaymentExpired(order.createdAt, now)
  );

  let closed = 0;
  const orderIds: string[] = [];

  for (const order of expired) {
    try {
      await closeExpiredPendingOrder(order.id);
      closed += 1;
      orderIds.push(order.id);
      console.log(
        `[order-expiry] closed pending order ${order.orderNo} (${order.id})`
      );
    } catch (err) {
      console.error(
        "[order-expiry] closeExpiredPendingOrders failed",
        order.id,
        err
      );
    }
  }

  return { scanned: pending.length, closed, orderIds };
}

/** 系统自动关闭单个超时待支付订单（幂等：仅 PENDING_PAYMENT 可关闭） */
export async function closeExpiredPendingOrder(orderId: string) {
  return prisma.$transaction(
    async (tx) => {
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: OrderStatus.PENDING_PAYMENT,
        },
        data: {
          status: OrderStatus.CANCELLED,
          cancelSource: OrderCancelSource.ADMIN,
        },
      });

      if (updated.count !== 1) {
        throw new Error("仅待支付订单可关闭");
      }

      await restoreOrderSkuStock(tx, orderId);

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 30000,
    }
  );
}

/** 关闭待支付订单并归还虚拟 SKU 库存（无 SALE_OUT，不涉及物理回库） */
export async function closePendingOrder(orderId: string, userId?: string) {
  return prisma.$transaction(
    async (tx) => {
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: OrderStatus.PENDING_PAYMENT,
          ...(userId ? { userId } : {}),
        },
        data: {
          status: OrderStatus.CANCELLED,
          cancelSource: userId
            ? OrderCancelSource.CUSTOMER
            : OrderCancelSource.ADMIN,
        },
      });

      if (updated.count !== 1) {
        throw new Error("仅待支付订单可关闭");
      }

      await restoreOrderSkuStock(tx, orderId);

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 30000,
    }
  );
}

/**
 * 已付订单退款取消：Serializable 事务内原路回库物理批次（IN_CANCEL）+ 可选归还虚拟 SKU。
 */
export async function refundPaidOrder(
  orderId: string,
  options: { rollbackStock: boolean; refundAmount?: number }
) {
  return prisma.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new Error("订单不存在");

      if (
        order.status !== OrderStatus.PAID &&
        order.status !== OrderStatus.PRODUCTION
      ) {
        throw new Error("仅已支付或制作中订单可退款取消");
      }

      const refundAmount = options.refundAmount ?? order.payAmount;

      await restorePhysicalStockFromSaleOutInTx(tx, orderId);

      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: order.status,
        },
        data: {
          status: OrderStatus.CANCELLED,
          refundAmount,
          refundTime: new Date(),
          cancelSource: OrderCancelSource.REFUND,
        },
      });

      if (updated.count !== 1) {
        throw new Error("订单状态已变更，请刷新后重试");
      }

      if (options.rollbackStock) {
        await restoreOrderSkuStock(tx, orderId);
      }

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 30000,
    }
  );
}

/** 店长将待支付标记为已支付（看板拖拽 1→2），同事务 FIFO 扣减物理批次 */
export async function adminMarkOrderPaid(orderId: string) {
  try {
    return await markOrderPaidWithFifo({ orderId, operator: "admin-mark-paid" });
  } catch (err) {
    if (err instanceof Error && err.message === "当前订单状态不可支付") {
      throw new Error("仅待支付订单可标记为已支付");
    }
    throw err;
  }
}

export type AdminTransition =
  | "PRODUCTION"
  | "DELIVERING"
  | "COMPLETED";

/** 后台履约流转（带前置状态校验） */
export async function adminTransitionOrder(
  orderId: string,
  next: AdminTransition,
  extra?: { deliveryInfo?: string }
) {
  if (next === "PRODUCTION") {
    const updated = await prisma.order.updateMany({
      where: { id: orderId, status: OrderStatus.PAID },
      data: { status: OrderStatus.PRODUCTION },
    });
    if (updated.count !== 1) {
      throw new Error("仅已支付订单可开始制作");
    }
  } else if (next === "DELIVERING") {
    const info = extra?.deliveryInfo?.trim();
    if (!info) throw new Error("请填写配送单号或配送电话");
    const updated = await prisma.order.updateMany({
      where: { id: orderId, status: OrderStatus.PRODUCTION },
      data: {
        status: OrderStatus.DELIVERING,
        deliveryInfo: info,
      },
    });
    if (updated.count !== 1) {
      throw new Error("仅制作中订单可发货配送");
    }
  } else if (next === "COMPLETED") {
    const updated = await prisma.order.updateMany({
      where: { id: orderId, status: OrderStatus.DELIVERING },
      data: { status: OrderStatus.COMPLETED },
    });
    if (updated.count !== 1) {
      throw new Error("仅配送中订单可标记完成");
    }
  }

  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
}

export async function listWechatOrdersForUser(userId: string) {
  return prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        select: {
          id: true,
          skuId: true,
          quantity: true,
          snapshotProductName: true,
          snapshotSpecName: true,
          snapshotPrice: true,
          snapshotImageUrl: true,
        },
      },
    },
  });
}

export async function listKanbanOrders() {
  return prisma.order.findMany({
    include: {
      items: {
        select: {
          snapshotProductName: true,
          snapshotSpecName: true,
          quantity: true,
        },
      },
      costSnapshot: {
        select: {
          grossMargin: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  [OrderStatus.PENDING_PAYMENT]: "待支付",
  [OrderStatus.PAID]: "已支付",
  [OrderStatus.PRODUCTION]: "制作中",
  [OrderStatus.DELIVERING]: "配送中",
  [OrderStatus.COMPLETED]: "已完成",
  [OrderStatus.CANCELLED]: "已取消",
};
