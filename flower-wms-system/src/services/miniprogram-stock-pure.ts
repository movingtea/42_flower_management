import {
  MINIPROGRAM_ERROR_CODES,
  MiniprogramBusinessError,
  type MiniprogramErrorCode,
} from "@/lib/miniprogram-business-error";

export const LOW_STOCK_THRESHOLD = 3;

export type SkuStockInput = {
  stock: number;
  isActive?: boolean;
};

export type StockFlags = {
  stock: number;
  hasStock: boolean;
  lowStock: boolean;
};

export type StockSummary = {
  totalStock: number;
  hasStock: boolean;
  lowStock: boolean;
};

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "SOLD_OUT";

export type DisplayStatus = "AVAILABLE" | "LOW_STOCK" | "SOLD_OUT" | "OFF_SHELF";

export type CartQuantityCheck =
  | { ok: true }
  | { ok: false; code: typeof MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK; message: string; available: number };

/** 仅保留运营可售 SKU（缺省 isActive 视为 true，兼容历史数据） */
export function filterActiveSkus<T extends SkuStockInput>(skus: ReadonlyArray<T>): T[] {
  return skus.filter((sku) => sku.isActive !== false);
}

export function hasActiveSku(skus: ReadonlyArray<SkuStockInput>): boolean {
  return filterActiveSkus(skus).length > 0;
}

export function computeSkuStockFlags(stock: number): StockFlags {
  const safeStock = Math.max(0, Math.floor(stock));
  return {
    stock: safeStock,
    hasStock: safeStock > 0,
    lowStock: safeStock > 0 && safeStock <= LOW_STOCK_THRESHOLD,
  };
}

/** 库存汇总只统计 isActive=true 的 SKU */
export function computeStockSummary(
  skus: ReadonlyArray<SkuStockInput>
): StockSummary {
  const activeSkus = filterActiveSkus(skus);
  const totalStock = activeSkus.reduce(
    (sum, sku) => sum + Math.max(0, Math.floor(sku.stock)),
    0
  );
  return {
    totalStock,
    hasStock: totalStock > 0,
    lowStock: totalStock > 0 && totalStock <= LOW_STOCK_THRESHOLD,
  };
}

export function resolveStockStatus(summary: StockSummary): StockStatus {
  if (!summary.hasStock) return "SOLD_OUT";
  if (summary.lowStock) return "LOW_STOCK";
  return "IN_STOCK";
}

export function resolveDisplayStatus(
  spu: { isActive: boolean; isDeleted: boolean },
  skus: ReadonlyArray<SkuStockInput>
): DisplayStatus {
  if (spu.isDeleted || !spu.isActive) return "OFF_SHELF";
  const activeSkus = filterActiveSkus(skus);
  if (activeSkus.length === 0) return "OFF_SHELF";
  const summary = computeStockSummary(activeSkus);
  if (!summary.hasStock) return "SOLD_OUT";
  if (summary.lowStock) return "LOW_STOCK";
  return "AVAILABLE";
}

export function formatStockLabel(stock: number): string {
  const flags = computeSkuStockFlags(stock);
  if (!flags.hasStock) return "卖光啦！";
  if (flags.lowStock) return `仅剩 ${flags.stock} 件`;
  return `库存 ${flags.stock}`;
}

export function formatInsufficientStockMessage(
  specName: string,
  available: number
): string {
  if (available <= 0) {
    return `${specName} 卖光啦！`;
  }
  return `库存不足，${specName} 当前仅剩 ${available} 件`;
}

export function mergeOrderLineQuantities(
  items: ReadonlyArray<{ skuId: string; quantity: number }>
): Map<string, number> {
  const merged = new Map<string, number>();
  for (const item of items) {
    merged.set(item.skuId, (merged.get(item.skuId) ?? 0) + item.quantity);
  }
  return merged;
}

export function validateCartQuantity(input: {
  stock: number;
  existingQty: number;
  addQty: number;
  specName?: string;
}): CartQuantityCheck {
  const available = Math.max(0, Math.floor(input.stock));
  const existingQty = Math.max(0, Math.floor(input.existingQty));
  const addQty = Math.max(0, Math.floor(input.addQty));
  const specName = input.specName?.trim() || "该规格";

  if (available <= 0) {
    return {
      ok: false,
      code: MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK,
      message: `${specName} 卖光啦！`,
      available: 0,
    };
  }

  if (existingQty + addQty > available) {
    return {
      ok: false,
      code: MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK,
      message: formatInsufficientStockMessage(specName, available),
      available,
    };
  }

  return { ok: true };
}

export function assertSellableSpu(spu: {
  isActive: boolean;
  isDeleted: boolean;
  name?: string;
}): void {
  if (spu.isDeleted || !spu.isActive) {
    throw new MiniprogramBusinessError(
      MINIPROGRAM_ERROR_CODES.PRODUCT_OFF_SHELF,
      "商品已下架"
    );
  }
}

export function assertSellableSku(sku: {
  isActive?: boolean;
  specName?: string;
}): void {
  if (sku.isActive === false) {
    throw new MiniprogramBusinessError(
      MINIPROGRAM_ERROR_CODES.SKU_INACTIVE,
      "该规格暂不可售"
    );
  }
}

export function assertOrderStockAvailable(input: {
  specName: string;
  stock: number;
  requestedQty: number;
  isActive?: boolean;
}): void {
  assertSellableSku(input);

  const available = Math.max(0, Math.floor(input.stock));
  const requestedQty = Math.floor(input.requestedQty);

  if (requestedQty <= 0) {
    throw new MiniprogramBusinessError(
      MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK,
      "商品数量无效"
    );
  }

  if (available < requestedQty) {
    throw new MiniprogramBusinessError(
      MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK,
      formatInsufficientStockMessage(input.specName, available)
    );
  }
}

export function mapCartInvalidReason(
  code: MiniprogramErrorCode | "SELECT_SPEC" | null,
  fallback?: string | null
): string | null {
  if (!code) return fallback ?? null;
  switch (code) {
    case MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK:
      return fallback ?? "库存不足";
    case MINIPROGRAM_ERROR_CODES.PRODUCT_OFF_SHELF:
      return "商品已下架";
    case MINIPROGRAM_ERROR_CODES.SKU_INACTIVE:
      return "该规格暂不可售";
    case MINIPROGRAM_ERROR_CODES.PRODUCT_NOT_FOUND:
      return "商品不存在";
    case MINIPROGRAM_ERROR_CODES.SKU_NOT_FOUND:
      return "规格不存在";
    case "SELECT_SPEC":
      return "请选择款式";
    default:
      return fallback ?? null;
  }
}
