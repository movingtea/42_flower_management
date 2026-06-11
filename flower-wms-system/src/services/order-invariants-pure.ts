import { OrderStatus } from "@/generated/prisma/enums";
import {
  MINIPROGRAM_ERROR_CODES,
  type MiniprogramErrorCode,
} from "@/lib/miniprogram-business-error";
import {
  resolveDisplayStatus,
  type DisplayStatus,
  filterActiveSkus,
} from "@/services/miniprogram-stock-pure";

/** 待支付订单自动关闭时长（毫秒） */
export const PENDING_PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;

export type OrderInvariantViolation = {
  code: string;
  message: string;
};

export type StockCheckResult = {
  allowed: boolean;
  code?: MiniprogramErrorCode;
  message?: string;
};

/** 库存不足不得修改商品上下架状态 */
export function assertStockFailureDoesNotChangeShelfState(input: {
  before: { isActive: boolean; isDeleted: boolean };
  after: { isActive: boolean; isDeleted: boolean };
}): OrderInvariantViolation | null {
  if (
    input.before.isActive === input.after.isActive &&
    input.before.isDeleted === input.after.isDeleted
  ) {
    return null;
  }
  return {
    code: "STOCK_FAILURE_MUTATED_SHELF",
    message: "库存不足或下单失败不得自动修改商品上下架状态",
  };
}

/** stock=0 是 SOLD_OUT，不是 OFF_SHELF */
export function assertSoldOutNotOffShelf(
  spu: { isActive: boolean; isDeleted: boolean },
  skus: ReadonlyArray<{ stock: number; isActive?: boolean }>
): OrderInvariantViolation | null {
  const status = resolveDisplayStatus(spu, skus);
  if (status === "SOLD_OUT") return null;
  if (status === "OFF_SHELF" && filterActiveSkus(skus).every((s) => s.stock <= 0)) {
    return {
      code: "SOLD_OUT_MAPPED_TO_OFF_SHELF",
      message: "售罄商品不得映射为下架",
    };
  }
  return null;
}

export function classifyDisplayStatusForInvariant(
  spu: { isActive: boolean; isDeleted: boolean },
  skus: ReadonlyArray<{ stock: number; isActive?: boolean }>
): DisplayStatus {
  return resolveDisplayStatus(spu, skus);
}

/** 库存不足应返回 INSUFFICIENT_STOCK，不得返回 PRODUCT_OFF_SHELF */
export function assertStockErrorCode(
  code: MiniprogramErrorCode | undefined,
  spu: { isActive: boolean; isDeleted: boolean }
): OrderInvariantViolation | null {
  if (spu.isActive && !spu.isDeleted && code === MINIPROGRAM_ERROR_CODES.PRODUCT_OFF_SHELF) {
    return {
      code: "WRONG_STOCK_ERROR_CODE",
      message: "库存不足不得返回 PRODUCT_OFF_SHELF",
    };
  }
  if (code === MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK) {
    return null;
  }
  return null;
}

/** 待支付取消 / 超时关闭：只回补虚拟库存，不涉及物理批次 */
export function pendingCancelStockInvariant(): {
  restoreProductSkuStock: true;
  decrementBatchRemainingQty: false;
  createSaleOut: false;
  createOrderCostSnapshot: false;
} {
  return {
    restoreProductSkuStock: true,
    decrementBatchRemainingQty: false,
    createSaleOut: false,
    createOrderCostSnapshot: false,
  };
}

/** 已支付退款默认不回填物理库存 */
export function paidRefundStockInvariant(rollbackStock: boolean): {
  defaultRollbackStock: false;
  rollbackStockWhenExplicit: boolean;
} {
  return {
    defaultRollbackStock: false,
    rollbackStockWhenExplicit: rollbackStock,
  };
}

/** 支付成功后才应扣物理批次并生成成本快照 */
export function paidOrderFulfillmentInvariant(status: OrderStatus): {
  shouldDecrementBatch: boolean;
  shouldCreateSaleOut: boolean;
  shouldCreateCostSnapshot: boolean;
} {
  const paidOrLater = (
    [
      OrderStatus.PAID,
      OrderStatus.PRODUCTION,
      OrderStatus.DELIVERING,
      OrderStatus.COMPLETED,
    ] as OrderStatus[]
  ).includes(status);

  return {
    shouldDecrementBatch: paidOrLater,
    shouldCreateSaleOut: paidOrLater,
    shouldCreateCostSnapshot: paidOrLater,
  };
}

export function isPendingPaymentExpired(
  createdAt: Date,
  now: Date = new Date()
): boolean {
  return now.getTime() - createdAt.getTime() >= PENDING_PAYMENT_TIMEOUT_MS;
}
