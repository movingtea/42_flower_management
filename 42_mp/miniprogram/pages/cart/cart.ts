// pages/cart/cart.ts — 购物车：勾选、改量、结算与 TabBar 角标
import {
  CHECKOUT_PRODUCTS_KEY,
  computeCartSummary,
  readCartFromStorage,
  selectedToCheckoutProducts,
  storageToCartList,
  updateCartTabBarBadge,
  writeCartToStorage,
  cartItemsToStorage,
  type CartListItem,
} from '../../utils/cart';

Page({
  data: {
    cartList: [] as CartListItem[],
    hasItems: false,
    cartListLength: 0,
    isAllSelected: false,
    totalPrice: '0.00',
    totalCount: 0,
    scrollHeight: 600,
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
   * 从本地缓存加载购物车并渲染（onLoad / onShow 双保险调用）。
   */
  loadCartData() {
    console.log('--- 真机调试购物车数据 --- 开始读取');

    const rawStorage = wx.getStorageSync('cart');
    console.log('--- 真机调试购物车数据 --- Storage 原始值', rawStorage);

    let stored = readCartFromStorage();
    if (!Array.isArray(stored)) {
      stored = [];
    }
    console.log('--- 真机调试购物车数据 ---', stored);

    const prevList = Array.isArray(this.data.cartList) ? this.data.cartList : [];
    const prevMap: Record<string, boolean> = {};
    prevList.forEach((row) => {
      if (row && row.id) {
        prevMap[row.id] = !!row.selected;
      }
    });

    let cartList = storageToCartList(stored, prevMap);
    if (!Array.isArray(cartList)) {
      cartList = [];
    }

    console.log('--- 真机调试购物车数据 --- 即将渲染 cartList', cartList);
    this.applyCartList(cartList, { syncBadge: true });
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

  findItemIndex(id: string): number {
    const list = Array.isArray(this.data.cartList) ? this.data.cartList : [];
    return list.findIndex((row) => row.id === id);
  },

  getCartListSafe(): CartListItem[] {
    return Array.isArray(this.data.cartList) ? this.data.cartList : [];
  },

  onToggleItemSelect(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const index = this.findItemIndex(id);
    if (index < 0) return;

    const cartList = [...this.getCartListSafe()];
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
    const id = e.currentTarget.dataset.id as string;
    const index = this.findItemIndex(id);
    if (index < 0) return;

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
    const id = e.currentTarget.dataset.id as string;
    const index = this.findItemIndex(id);
    if (index < 0) return;

    const cartList = [...this.getCartListSafe()];
    cartList[index] = {
      ...cartList[index],
      quantity: cartList[index].quantity + 1,
    };
    this.persistCartList(cartList);
  },

  onDeleteItem(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const index = this.findItemIndex(id);
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
    const selectedProducts = this.getCartListSafe().filter((item) => item.selected);
    if (selectedProducts.length === 0) {
      wx.showToast({ title: '请选择要结算的商品', icon: 'none' });
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
