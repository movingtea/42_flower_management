// pages/cart/cart.ts — 购物车：勾选、改量、结算与 TabBar 角标
import { baseUrl } from '../../config/index';
import { toRelativeImagePath } from '../../utils/image';
import {
  CHECKOUT_PRODUCTS_KEY,
  cartLineKey,
  computeCartSummary,
  readCartFromStorage,
  selectedToCheckoutProducts,
  storageToCartList,
  updateCartTabBarBadge,
  writeCartToStorage,
  cartItemsToStorage,
  type CartListItem,
} from '../../utils/cart';
import { request } from '../../utils/request';

interface CartSyncLine {
  productId: string;
  quantity: number;
  isInvalid: boolean;
  invalidReason?: string | null;
  product?: {
    name: string;
    sellPrice: string;
    imageUrl: string | null;
    shippingFee?: number;
  } | null;
}

Page({
  data: {
    cartList: [] as CartListItem[],
    hasItems: false,
    cartListLength: 0,
    isAllSelected: false,
    totalPrice: '0.00',
    totalCount: 0,
    scrollHeight: 600,
    baseUrl,
  },

  onLoad() {
    this.initScrollHeight();
    this.loadCartData();
  },

  onShow() {
    this.loadCartData();
  },

  initScrollHeight() {
    try {
      const sys = wx.getSystemInfoSync();
      const footerPx = Math.floor((120 * sys.windowWidth) / 750);
      const scrollHeight = Math.max(320, sys.windowHeight - footerPx);
      this.setData({ scrollHeight });
    } catch (err) {
      console.warn('--- 真机调试购物车数据 --- 计算滚动高度失败', err);
    }
  },

  /**
   * 从本地缓存加载购物车，并向后端校验商品是否失效。
   */
  loadCartData() {
    let stored = readCartFromStorage();
    if (!Array.isArray(stored)) {
      stored = [];
    }

    const prevList = Array.isArray(this.data.cartList) ? this.data.cartList : [];
    const prevMap: Record<string, boolean> = {};
    prevList.forEach((row) => {
      if (row && row.id) {
        prevMap[cartLineKey(row)] = !!row.selected;
      }
    });

    if (stored.length === 0) {
      this.applyCartList([], { syncBadge: true });
      return;
    }

    request<{ list: CartSyncLine[] }>({
      url: '/cart',
      method: 'POST',
      data: {
        items: stored.map((row) => ({
          productId: row.id,
          skuId: row.skuId,
          quantity: row.quantity,
        })),
      },
    })
      .then((res) => {
        const lines = res?.list ?? [];
        const invalidByKey: Record<string, boolean> = {};
        const lineMap = new Map(
          lines.map((line) => [
            cartLineKey({
              id: line.productId,
              skuId: line.skuId ?? undefined,
            }),
            line,
          ])
        );

        const mergedStored = stored.map((row) => {
          const key = cartLineKey(row);
          const line = lineMap.get(key);
          if (line?.isInvalid) {
            invalidByKey[key] = true;
          }
          if (line?.product) {
            return {
              ...row,
              name: line.product.name || row.name,
              price: line.product.sellPrice ?? row.price,
              imageUrl: toRelativeImagePath(
                line.product.imageUrl || row.imageUrl
              ),
              shippingFee: line.product.shippingFee ?? row.shippingFee,
            };
          }
          if (!line) {
            invalidByKey[key] = true;
          }
          return row;
        });

        writeCartToStorage(mergedStored);

        const cartList = storageToCartList(mergedStored, prevMap, invalidByKey).map(
          (item) => {
            const line = lineMap.get(cartLineKey(item));
            return {
              ...item,
              invalidReason: line?.invalidReason ?? item.invalidReason,
            };
          }
        );

        this.applyCartList(cartList, { syncBadge: true });
      })
      .catch(() => {
        const cartList = storageToCartList(stored, prevMap);
        this.applyCartList(cartList, { syncBadge: true });
      });
  },

  applyCartList(cartList: CartListItem[] | undefined, options?: { syncBadge?: boolean }) {
    const safeList = Array.isArray(cartList) ? cartList : [];
    const summary = computeCartSummary(safeList);
    const hasItems = safeList.length > 0;

    this.setData({
      cartList: safeList,
      hasItems,
      cartListLength: safeList.length,
      isAllSelected: summary.isAllSelected,
      totalPrice: summary.totalPrice,
      totalCount: summary.totalCount,
    });

    console.log(
      '--- 真机调试购物车数据 --- setData 完成',
      'hasItems:',
      hasItems,
      'cartListLength:',
      safeList.length
    );

    if (options?.syncBadge !== false) {
      updateCartTabBarBadge(cartItemsToStorage(safeList));
    }
  },

  persistCartList(cartList: CartListItem[]) {
    const safeList = Array.isArray(cartList) ? cartList : [];
    writeCartToStorage(cartItemsToStorage(safeList));
    this.applyCartList(safeList);
  },

  findItemIndex(lineKey: string): number {
    const list = Array.isArray(this.data.cartList) ? this.data.cartList : [];
    return list.findIndex((row) => cartLineKey(row) === lineKey);
  },

  getCartListSafe(): CartListItem[] {
    return Array.isArray(this.data.cartList) ? this.data.cartList : [];
  },

  onToggleItemSelect(e: WechatMiniprogram.TouchEvent) {
    const lineKey = e.currentTarget.dataset.lineKey as string;
    const index = this.findItemIndex(lineKey);
    if (index < 0) return;

    const cartList = [...this.getCartListSafe()];
    if (cartList[index].isInvalid) {
      wx.showToast({ title: '该商品已下架', icon: 'none' });
      return;
    }
    cartList[index] = {
      ...cartList[index],
      selected: !cartList[index].selected,
    };
    this.applyCartList(cartList, { syncBadge: false });
  },

  onToggleSelectAll() {
    const nextAll = !this.data.isAllSelected;
    const cartList = this.getCartListSafe().map((item) => ({
      ...item,
      selected: nextAll,
    }));
    this.applyCartList(cartList, { syncBadge: false });
  },

  onQuantityMinus(e: WechatMiniprogram.TouchEvent) {
    const lineKey = e.currentTarget.dataset.lineKey as string;
    const index = this.findItemIndex(lineKey);
    if (index < 0) return;
    if (this.getCartListSafe()[index].isInvalid) return;

    const cartList = [...this.getCartListSafe()];
    const qty = cartList[index].quantity;
    if (qty <= 1) {
      this.removeItemByIndex(index);
      return;
    }

    cartList[index] = { ...cartList[index], quantity: qty - 1 };
    this.persistCartList(cartList);
  },

  onQuantityPlus(e: WechatMiniprogram.TouchEvent) {
    const lineKey = e.currentTarget.dataset.lineKey as string;
    const index = this.findItemIndex(lineKey);
    if (index < 0) return;
    if (this.getCartListSafe()[index].isInvalid) return;

    const cartList = [...this.getCartListSafe()];
    cartList[index] = {
      ...cartList[index],
      quantity: cartList[index].quantity + 1,
    };
    this.persistCartList(cartList);
  },

  onDeleteItem(e: WechatMiniprogram.TouchEvent) {
    const lineKey = e.currentTarget.dataset.lineKey as string;
    const index = this.findItemIndex(lineKey);
    if (index < 0) return;

    wx.showModal({
      title: '移除商品',
      content: '确定从购物车中删除该商品吗？',
      confirmColor: '#8fa89b',
      success: (res) => {
        if (res.confirm) {
          this.removeItemByIndex(index);
        }
      },
    });
  },

  removeItemByIndex(index: number) {
    const cartList = this.getCartListSafe().filter((_, i) => i !== index);
    this.persistCartList(cartList);
  },

  onGoShopping() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  onCheckout() {
    const selectedProducts = this.getCartListSafe().filter(
      (item) => item.selected && !item.isInvalid
    );
    if (selectedProducts.length === 0) {
      wx.showToast({ title: '请选择有效商品', icon: 'none' });
      return;
    }

    const hasInvalidSelected = this.getCartListSafe().some(
      (item) => item.selected && item.isInvalid
    );
    if (hasInvalidSelected) {
      wx.showToast({ title: '已下架商品无法结算', icon: 'none' });
      return;
    }

    wx.setStorageSync(
      CHECKOUT_PRODUCTS_KEY,
      selectedToCheckoutProducts(selectedProducts)
    );

    wx.navigateTo({
      url: '/pages/checkout/checkout',
      fail: () => {
        wx.showToast({ title: '结算页跳转失败', icon: 'none' });
      },
    });
  },
});
