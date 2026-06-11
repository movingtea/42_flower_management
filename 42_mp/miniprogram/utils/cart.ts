import { toRelativeImagePath } from './image';

/** 购物车本地缓存条目（wx.setStorageSync('cart')） */
export interface CartItem {
  /** SPU id */
  id: string;
  skuId?: string;
  sku?: string;
  specName?: string;
  name: string;
  price: number | string;
  imageUrl: string;
  quantity: number;
  /** 单件商品运费，0 表示免运费 */
  shippingFee?: number;
}

/** 页面展示用：在 CartItem 上扩展勾选状态（不写入本地缓存） */
export interface CartListItem extends CartItem {
  /** 列表行唯一键（SPU + SKU） */
  lineKey: string;
  selected: boolean;
  /** 商品已软删除、未上架或库存不足时为 true */
  isInvalid?: boolean;
  invalidReason?: string | null;
  invalidCode?: string | null;
  /** 服务端返回的当前 SKU 可售库存 */
  availableStock?: number;
}

export const CART_STORAGE_KEY = 'cart';

/** 待结算商品临时缓存（勾选后写入，供结算页读取） */
export const CHECKOUT_PRODUCTS_KEY = 'checkout_products';

/** @deprecated 请使用 CHECKOUT_PRODUCTS_KEY */
export const CHECKOUT_CART_KEY = 'checkout_products';

/** app.json tabBar.list 中「购物车」的下标（从 0 开始） */
export const CART_TAB_BAR_INDEX = 2;

export function readCartFromStorage(): CartItem[] {
  let raw: unknown;
  try {
    raw = wx.getStorageSync(CART_STORAGE_KEY);
  } catch (err) {
    console.warn('--- 真机调试购物车数据 --- 读取 Storage 异常', err);
    return [];
  }

  if (raw == null || raw === '') {
    return [];
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(
      (row): row is CartItem =>
        !!row &&
        typeof row === 'object' &&
        typeof (row as CartItem).id === 'string' &&
        typeof (row as CartItem).name === 'string' &&
        typeof (row as CartItem).quantity === 'number'
    )
    .map((row) => ({
      id: row.id,
      skuId: typeof row.skuId === 'string' ? row.skuId : undefined,
      sku: row.sku,
      specName: typeof row.specName === 'string' ? row.specName : undefined,
      name: row.name,
      price: row.price ?? '0',
      imageUrl: toRelativeImagePath(
        typeof row.imageUrl === 'string' ? row.imageUrl : ''
      ),
      quantity: Math.max(1, Math.floor(Number(row.quantity)) || 1),
      shippingFee: Math.max(0, Number((row as CartItem).shippingFee) || 0),
    }));
}

export function writeCartToStorage(cart: CartItem[]): void {
  wx.setStorageSync(CART_STORAGE_KEY, cart);
}

/** 购物车内所有 SKU 的总件数（quantity 之和，与是否勾选无关） */
export function getCartTotalPieceCount(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
}

export function parseCartPrice(price: number | string): number {
  const n = typeof price === 'number' ? price : parseFloat(String(price));
  return Number.isFinite(n) ? n : 0;
}

/** 购物车行唯一键：同一 SPU 的不同 SKU 分开展示 */
export function cartLineKey(item: Pick<CartItem, 'id' | 'skuId'>): string {
  return item.skuId ? `${item.id}:${item.skuId}` : item.id;
}

export function findCartLineIndex(cart: CartItem[], spuId: string, skuId?: string): number {
  const key = cartLineKey({ id: spuId, skuId });
  return cart.findIndex((row) => cartLineKey(row) === key);
}

export function cartItemsToStorage(list: CartListItem[]): CartItem[] {
  return list.map(({ id, skuId, sku, specName, name, price, imageUrl, quantity, shippingFee }) => ({
    id,
    skuId,
    sku,
    specName,
    name,
    price,
    imageUrl,
    quantity,
    shippingFee: Math.max(0, Number(shippingFee) || 0),
  }));
}

/** 勾选商品写入结算缓存（不含 selected 字段） */
export function selectedToCheckoutProducts(list: CartListItem[]): CartItem[] {
  return cartItemsToStorage(list);
}

export function storageToCartList(
  cart: CartItem[],
  prevSelected?: Record<string, boolean>,
  metaByKey?: Record<
    string,
    {
      isInvalid?: boolean;
      invalidReason?: string | null;
      invalidCode?: string | null;
      availableStock?: number;
      quantity?: number;
    }
  >
): CartListItem[] {
  return cart.map((item) => {
    const key = cartLineKey(item);
    const meta = metaByKey?.[key];
    const isInvalid = meta?.isInvalid === true;
    const quantity =
      meta?.quantity != null
        ? Math.max(1, Math.floor(meta.quantity))
        : item.quantity;
    return {
      ...item,
      quantity,
      lineKey: key,
      isInvalid,
      invalidReason: meta?.invalidReason ?? (isInvalid ? '商品不可结算' : null),
      invalidCode: meta?.invalidCode ?? null,
      availableStock: meta?.availableStock,
      selected: isInvalid ? false : (prevSelected?.[key] ?? true),
    };
  });
}

export type CartSummary = {
  isAllSelected: boolean;
  totalPrice: string;
  /** 已勾选商品的总件数（quantity 之和） */
  totalCount: number;
};

export function computeCartSummary(list: CartListItem[]): CartSummary {
  let totalPrice = 0;
  let totalCount = 0;

  const selectable = list.filter((item) => !item.isInvalid);

  for (const item of list) {
    if (item.selected && !item.isInvalid) {
      totalCount += item.quantity;
      totalPrice += parseCartPrice(item.price) * item.quantity;
    }
  }

  const isAllSelected =
    selectable.length > 0 &&
    selectable.every((item) => item.selected);

  return {
    isAllSelected,
    totalPrice: totalPrice.toFixed(2),
    totalCount,
  };
}

/**
 * 刷新底部 TabBar 购物车角标（总件数，非勾选数）。
 * 总件数为 0 时移除角标。
 */
/** 从购物车移除已结算行（按 SPU+SKU 行键） */
export function removeCartLinesByKeys(keys: string[]): void {
  if (!keys.length) return;
  const keySet = new Set(keys);
  const cart = readCartFromStorage().filter(
    (row) => !keySet.has(cartLineKey(row))
  );
  writeCartToStorage(cart);
  updateCartTabBarBadge(cart);
}

/** 仅清除结算页临时缓存，不动购物车 */
export function clearCheckoutStorageOnly(): void {
  try {
    wx.removeStorageSync(CHECKOUT_PRODUCTS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 支付成功后精准清洗：仅移除本次下单涉及的 skuId 对应条目。
 */
export function removePurchasedSkusFromCart(skuIds: string[]): void {
  const idSet = new Set(skuIds.filter(Boolean));
  if (!idSet.size) return;

  const cart = readCartFromStorage().filter(
    (row) => !row.skuId || !idSet.has(row.skuId)
  );
  writeCartToStorage(cart);
  updateCartTabBarBadge(cart);
}

/** @deprecated 请使用 removePurchasedSkusFromCart + clearCheckoutStorageOnly */
export function clearCheckoutAndCartLines(items: CartItem[]): void {
  clearCheckoutStorageOnly();
  removePurchasedSkusFromCart(
    items.map((row) => row.skuId).filter((id): id is string => !!id)
  );
}

export function updateCartTabBarBadge(cart?: CartItem[]): void {
  const items = cart ?? readCartFromStorage();
  const total = getCartTotalPieceCount(items);

  if (total <= 0) {
    wx.removeTabBarBadge({ index: CART_TAB_BAR_INDEX });
    return;
  }

  wx.setTabBarBadge({
    index: CART_TAB_BAR_INDEX,
    text: total > 99 ? '99+' : String(total),
  });
}
