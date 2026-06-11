import {
  MINIPROGRAM_ERROR_CODES,
  MiniprogramBusinessError,
  type MiniprogramErrorCode,
} from "@/lib/miniprogram-business-error";

export const LOW_STOCK_THRESHOLD = 3;

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

export type DisplayStatus = "AVAILABLE" | "SOLD_OUT" | "OFF_SHELF";

export type CartQuantityCheck =
  | { ok: true }
  | { ok: false; code: typeof MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK; message: string; available: number };

export function computeSkuStockFlags(stock: number): StockFlags {
  const safeStock = Math.max(0, Math.floor(stock));
  return {
    stock: safeStock,
    hasStock: safeStock > 0,
    lowStock: safeStock > 0 && safeStock <= LOW_STOCK_THRESHOLD,
  };
}

export function computeStockSummary(
  skus: ReadonlyArray<{ stock: number }>
): StockSummary {
  const totalStock = skus.reduce(
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
  skus: ReadonlyArray<{ stock: number }>
): DisplayStatus {
  if (spu.isDeleted || !spu.isActive) return "OFF_SHELF";
  const summary = computeStockSummary(skus);
  if (!summary.hasStock) return "SOLD_OUT";
  return "AVAILABLE";
}

export function formatStockLabel(stock: number): string {
  const flags = computeSkuStockFlags(stock);
  if (!flags.hasStock) return "暂时售罄";
  if (flags.lowStock) return `仅剩 ${flags.stock} 件`;
  return `库存 ${flags.stock}`;
}

export function formatInsufficientStockMessage(
  specName: string,
  available: number
): string {
  if (available <= 0) {
    return `${specName} 暂时售罄`;
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
      message: `${specName} 暂时售罄`,
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

export function assertOrderStockAvailable(input: {
  specName: string;
  stock: number;
  requestedQty: number;
}): void {
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
