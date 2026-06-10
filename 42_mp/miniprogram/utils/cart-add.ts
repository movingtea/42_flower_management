import {
  CHECKOUT_PRODUCTS_KEY,
  findCartLineIndex,
  readCartFromStorage,
  updateCartTabBarBadge,
  writeCartToStorage,
  type CartItem,
} from './cart';
import { toRelativeImagePath } from './image';

export type AddCartPayload = {
  spuId: string;
  skuId: string;
  skuCode: string;
  specName: string;
  name: string;
  price: string;
  imageUrl: string;
  shippingFee: number;
};

export function addPayloadToCart(payload: AddCartPayload): void {
  const cart = readCartFromStorage();
  const index = findCartLineIndex(cart, payload.spuId, payload.skuId);
  const displayName =
    payload.specName && !payload.name.includes(payload.specName)
      ? `${payload.name}（${payload.specName}）`
      : payload.name;

  if (index >= 0) {
    cart[index].quantity += 1;
  } else {
    cart.push({
      id: payload.spuId,
      skuId: payload.skuId,
      sku: payload.skuCode,
      specName: payload.specName,
      name: displayName,
      price: payload.price,
      imageUrl: toRelativeImagePath(payload.imageUrl),
      quantity: 1,
      shippingFee: payload.shippingFee,
    });
  }

  writeCartToStorage(cart);
  updateCartTabBarBadge(cart);
}

/** 立即预订：写入结算缓存并跳转下单页（不经过购物车） */
export function buyNow(payload: AddCartPayload): void {
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
    quantity: 1,
    shippingFee: payload.shippingFee,
  };

  wx.setStorageSync(CHECKOUT_PRODUCTS_KEY, [item]);
  wx.navigateTo({
    url: '/pages/checkout/checkout',
    fail: () => {
      wx.showToast({ title: '下单页打开失败', icon: 'none' });
    },
  });
}
