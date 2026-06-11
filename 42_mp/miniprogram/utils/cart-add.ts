import {
  CHECKOUT_PRODUCTS_KEY,
  findCartLineIndex,
  readCartFromStorage,
  updateCartTabBarBadge,
  writeCartToStorage,
  type CartItem,
} from './cart';
import { request } from './request';
import { validateLocalCartQuantity } from './stock';
import { toRelativeImagePath } from './image';
import type { BulkPreorderRule } from './preorder-rule';

export type AddCartPayload = {
  spuId: string;
  skuId: string;
  skuCode: string;
  specName: string;
  name: string;
  price: string;
  imageUrl: string;
  shippingFee: number;
  stock: number;
  quantity?: number;
  bulkPreorderRule?: BulkPreorderRule | null;
};

type ValidateAddResponse = {
  ok?: boolean;
  availableStock?: number;
};

function showStockError(message: string): void {
  wx.showToast({ title: message, icon: 'none' });
}

async function validateAddOnServer(payload: AddCartPayload, quantity: number): Promise<boolean> {
  const cart = readCartFromStorage();
  try {
    await request<ValidateAddResponse>({
      url: '/cart',
      method: 'POST',
      quiet: true,
      data: {
        action: 'validate-add',
        spuId: payload.spuId,
        skuId: payload.skuId,
        quantity,
        existingItems: cart.map((row) => ({
          productId: row.id,
          skuId: row.skuId,
          quantity: row.quantity,
        })),
      },
    });
    return true;
  } catch (err) {
    const body = err as { error?: string; code?: string };
    showStockError(body?.error || '库存不足');
    return false;
  }
}

export async function addPayloadToCart(payload: AddCartPayload): Promise<boolean> {
  const quantity = Math.max(1, Math.floor(Number(payload.quantity) || 1));
  const cart = readCartFromStorage();
  const index = findCartLineIndex(cart, payload.spuId, payload.skuId);
  const existingQty = index >= 0 ? cart[index].quantity : 0;

  const localCheck = validateLocalCartQuantity({
    stock: payload.stock,
    existingQty,
    addQty: quantity,
    specName: payload.specName,
  });
  if (!localCheck.ok) {
    showStockError(localCheck.message);
    return false;
  }

  const serverOk = await validateAddOnServer(payload, quantity);
  if (!serverOk) {
    return false;
  }

  const displayName =
    payload.specName && !payload.name.includes(payload.specName)
      ? `${payload.name}（${payload.specName}）`
      : payload.name;

  if (index >= 0) {
    cart[index].quantity += quantity;
  } else {
    cart.push({
      id: payload.spuId,
      skuId: payload.skuId,
      sku: payload.skuCode,
      specName: payload.specName,
      name: displayName,
      price: payload.price,
      imageUrl: toRelativeImagePath(payload.imageUrl),
      quantity,
      shippingFee: payload.shippingFee,
      bulkPreorderRule: payload.bulkPreorderRule ?? null,
    });
  }

  writeCartToStorage(cart);
  updateCartTabBarBadge(cart);
  return true;
}

/** 立即预订：写入结算缓存并跳转下单页（不经过购物车） */
export async function buyNow(payload: AddCartPayload): Promise<boolean> {
  const quantity = Math.max(1, Math.floor(Number(payload.quantity) || 1));
  const localCheck = validateLocalCartQuantity({
    stock: payload.stock,
    existingQty: 0,
    addQty: quantity,
    specName: payload.specName,
  });
  if (!localCheck.ok) {
    showStockError(localCheck.message);
    return false;
  }

  const serverOk = await validateAddOnServer(payload, quantity);
  if (!serverOk) {
    return false;
  }

  const displayName =
    payload.specName && !payload.name.includes(payload.specName)
      ? `${payload.name}（${payload.specName}）`
      : payload.name;

  const item: CartItem = {
    id: payload.spuId,
    skuId: payload.skuId,
    sku: payload.skuCode,
    specName: payload.specName,
    name: displayName,
    price: payload.price,
    imageUrl: toRelativeImagePath(payload.imageUrl),
    quantity,
    shippingFee: payload.shippingFee,
    bulkPreorderRule: payload.bulkPreorderRule ?? null,
  };

  wx.setStorageSync(CHECKOUT_PRODUCTS_KEY, [item]);
  wx.navigateTo({
    url: '/pages/checkout/checkout',
    fail: () => {
      wx.showToast({ title: '下单页打开失败', icon: 'none' });
    },
  });
  return true;
}
