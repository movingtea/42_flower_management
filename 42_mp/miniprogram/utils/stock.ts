import type { WechatProductItem, WechatProductSku } from './product';

export const LOW_STOCK_THRESHOLD = 3;

export type StockSummary = {
  totalStock: number;
  hasStock: boolean;
  lowStock: boolean;
};

export function computeStockSummaryFromSkus(
  skus: ReadonlyArray<Pick<WechatProductSku, 'stock'>>
): StockSummary {
  const totalStock = skus.reduce(
    (sum, sku) => sum + Math.max(0, Math.floor(Number(sku.stock) || 0)),
    0
  );
  return {
    totalStock,
    hasStock: totalStock > 0,
    lowStock: totalStock > 0 && totalStock <= LOW_STOCK_THRESHOLD,
  };
}

export function resolveProductStockSummary(
  product: Pick<WechatProductItem, 'skus' | 'stockSummary'>
): StockSummary {
  if (product.stockSummary) {
    return product.stockSummary;
  }
  return computeStockSummaryFromSkus(product.skus);
}

export function formatSkuStockLabel(stock: number): string {
  const safe = Math.max(0, Math.floor(Number(stock) || 0));
  if (safe <= 0) return '卖光啦！';
  if (safe <= LOW_STOCK_THRESHOLD) return `仅剩 ${safe} 件`;
  return `库存 ${safe}`;
}

export function formatProductStockLabel(product: WechatProductItem): string {
  const summary = resolveProductStockSummary(product);
  if (!summary.hasStock) return '卖光啦！';
  if (summary.lowStock) return `仅剩 ${summary.totalStock} 件`;
  return `库存 ${summary.totalStock}`;
}

export function isSoldOutProduct(product: WechatProductItem): boolean {
  return !resolveProductStockSummary(product).hasStock;
}

export function canPurchaseSku(sku: Pick<WechatProductSku, 'stock'>): boolean {
  return Math.max(0, Math.floor(Number(sku.stock) || 0)) > 0;
}

export function validateLocalCartQuantity(input: {
  stock: number;
  existingQty: number;
  addQty?: number;
  nextQty?: number;
  specName?: string;
}): { ok: true } | { ok: false; message: string } {
  const stock = Math.max(0, Math.floor(Number(input.stock) || 0));
  const specName = input.specName?.trim() || '该规格';

  if (stock <= 0) {
    return { ok: false, message: `${specName} 卖光啦！` };
  }

  if (input.nextQty != null) {
    const nextQty = Math.floor(Number(input.nextQty) || 0);
    if (nextQty > stock) {
      return {
        ok: false,
        message: `库存不足，当前仅剩 ${stock} 件`,
      };
    }
    return { ok: true };
  }

  const existingQty = Math.max(0, Math.floor(Number(input.existingQty) || 0));
  const addQty = Math.max(1, Math.floor(Number(input.addQty) || 1));
  if (existingQty + addQty > stock) {
    return {
      ok: false,
      message: `库存不足，当前仅剩 ${stock} 件`,
    };
  }

  return { ok: true };
}

export function mapInvalidCartTag(
  invalidReason?: string | null,
  invalidCode?: string | null
): string {
  if (invalidCode === 'SKU_INACTIVE') {
    return '该规格暂不可售';
  }
  if (invalidCode === 'INSUFFICIENT_STOCK') {
    return invalidReason || '卖光啦！';
  }
  if (invalidCode === 'PRODUCT_OFF_SHELF') {
    return '商品已下架';
  }
  if (invalidReason?.includes('卖光') || invalidReason?.includes('售罄')) {
    return invalidReason.includes('卖光') ? invalidReason : '卖光啦！';
  }
  if (invalidReason?.includes('库存不足')) {
    return invalidReason;
  }
  if (invalidCode === 'PRODUCT_NOT_FOUND' || invalidCode === 'SKU_NOT_FOUND') {
    return '商品已失效';
  }
  return invalidReason || '商品已下架';
}
