// pages/checkout/checkout.ts — 结算与模拟支付闭环
import { baseUrl } from '../../config/index';
import { toRelativeImagePath } from '../../utils/image';
import { isLoggedIn } from '../../utils/auth';
import {
  CHECKOUT_PRODUCTS_KEY,
  clearCheckoutStorageOnly,
  removePurchasedSkusFromCart,
  parseCartPrice,
  type CartItem,
} from '../../utils/cart';
import { fetchUserProfile, patchUserProfile } from '../../utils/user-api';
import {
  calcDeliveryFee,
  createOrder,
  mockPayOrder,
  FREE_SHIPPING_THRESHOLD,
  DEFAULT_DELIVERY_FEE,
} from '../../utils/order-api';

interface CheckoutDisplayItem {
  lineKey: string;
  spuId: string;
  skuId: string;
  name: string;
  specName: string;
  price: number;
  priceText: string;
  quantity: number;
  lineSubtotal: string;
  imageUrl: string;
}

const TIME_BUCKETS = ['上午', '下午', '晚上'];

function todayString(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatMoney(n: number): string {
  return Number(n.toFixed(2)).toFixed(2);
}

function cartRowsToDisplay(items: CartItem[]): CheckoutDisplayItem[] {
  return items.map((row) => {
    const price = parseCartPrice(row.price);
    const qty = Math.max(1, Math.floor(Number(row.quantity)) || 1);
    const skuId = row.skuId?.trim() ?? '';

    return {
      lineKey: row.skuId ? `${row.id}:${row.skuId}` : row.id,
      spuId: row.id,
      skuId,
      name: row.name,
      specName: row.specName ?? row.sku ?? '默认款式',
      price,
      priceText: formatMoney(price),
      quantity: qty,
      lineSubtotal: formatMoney(price * qty),
      imageUrl: toRelativeImagePath(row.imageUrl),
    };
  });
}

Page({
  data: {
    receiverName: '',
    receiverPhone: '',
    deliveryAddress: '',
    deliveryDate: '',
    minDeliveryDate: todayString(),
    timeBuckets: TIME_BUCKETS,
    deliveryTimeBucketIndex: 0,
    deliveryTimeBucket: TIME_BUCKETS[0],
    greetingCard: '',
    checkoutItems: [] as CheckoutDisplayItem[],
    checkoutSourceItems: [] as CartItem[],
    productTotal: '0.00',
    shippingFee: '0.00',
    shippingHint: '',
    payableTotal: '0.00',
    submitting: false,
    emptyCheckout: true,
    baseUrl,
    freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
    defaultDeliveryFee: DEFAULT_DELIVERY_FEE,
  },

  onLoad() {
    this.loadCheckoutProducts();
    void this.prefillDefaultAddress();
  },

  onShow() {
    this.loadCheckoutProducts();
    void this.prefillDefaultAddress();
  },

  async prefillDefaultAddress() {
    if (!isLoggedIn()) return;
    try {
      const data = await fetchUserProfile();
      const user = data?.user;
      if (!user) return;

      const patch: Record<string, string> = {};
      if (!this.data.receiverName && user.defaultReceiverName) {
        patch.receiverName = user.defaultReceiverName;
      }
      if (!this.data.receiverPhone && user.defaultReceiverPhone) {
        patch.receiverPhone = user.defaultReceiverPhone;
      }
      if (!this.data.deliveryAddress && user.defaultAddress) {
        patch.deliveryAddress = user.defaultAddress;
      }

      if (Object.keys(patch).length) {
        this.setData(patch);
      }
    } catch {
      /* 忽略 */
    }
  },

  onChooseWechatAddress() {
    wx.chooseAddress({
      success: (res) => {
        const receiverName = res.userName || '';
        const receiverPhone = res.telNumber || '';
        const deliveryAddress = [
          res.provinceName,
          res.cityName,
          res.countyName,
          res.detailInfo,
        ]
          .filter(Boolean)
          .join('');

        this.setData({
          receiverName,
          receiverPhone,
          deliveryAddress,
        });

        void patchUserProfile({
          defaultReceiverName: receiverName,
          defaultReceiverPhone: receiverPhone,
          defaultAddress: deliveryAddress,
        }).catch(() => {});

        wx.showToast({ title: '地址已导入', icon: 'success' });
      },
      fail: (err) => {
        const msg = (err as { errMsg?: string }).errMsg ?? '';
        if (msg.includes('cancel')) return;
        wx.showToast({ title: '未能获取微信地址', icon: 'none' });
      },
    });
  },

  loadCheckoutProducts() {
    let raw: unknown;
    try {
      raw = wx.getStorageSync(CHECKOUT_PRODUCTS_KEY);
    } catch {
      raw = null;
    }

    if (!Array.isArray(raw) || raw.length === 0) {
      this.setData({
        checkoutItems: [],
        checkoutSourceItems: [],
        emptyCheckout: true,
      });
      this.recalcAmounts([]);
      return;
    }

    const rows = raw.filter(
      (row): row is CartItem =>
        !!row &&
        typeof row === 'object' &&
        typeof (row as CartItem).id === 'string' &&
        typeof (row as CartItem).name === 'string'
    );

    const checkoutItems = cartRowsToDisplay(rows);
    this.setData({
      checkoutItems,
      checkoutSourceItems: rows,
      emptyCheckout: checkoutItems.length === 0,
    });
    this.recalcAmounts(checkoutItems);
  },

  recalcAmounts(items?: CheckoutDisplayItem[]) {
    const list = items ?? this.data.checkoutItems;
    const productTotalNum = list.reduce(
      (sum, row) => sum + row.price * row.quantity,
      0
    );
    const shippingFeeNum = calcDeliveryFee(productTotalNum);
    const payableTotalNum = productTotalNum + shippingFeeNum;

    const shippingHint =
      shippingFeeNum === 0
        ? `已满 ${FREE_SHIPPING_THRESHOLD} 元，免运费`
        : `满 ${FREE_SHIPPING_THRESHOLD} 元包邮，当前运费 ¥${formatMoney(shippingFeeNum)}`;

    this.setData({
      productTotal: formatMoney(productTotalNum),
      shippingFee: formatMoney(shippingFeeNum),
      payableTotal: formatMoney(payableTotalNum),
      shippingHint,
    });
  },

  onGoCart() {
    wx.switchTab({ url: '/pages/cart/cart' });
  },

  validateForm(): string | null {
    const { receiverName, receiverPhone, deliveryAddress, checkoutItems, emptyCheckout } =
      this.data;

    if (emptyCheckout || !checkoutItems.length) {
      return '暂无待结算商品，请返回购物车勾选';
    }

    if (!receiverName.trim()) return '请先选择收货地址';
    if (!receiverPhone.trim()) return '请先选择收货地址';
    if (!deliveryAddress.trim()) return '请先选择收货地址';
    if (!this.data.deliveryDate) return '请选择配送日期';
    if (!this.data.deliveryTimeBucket) return '请选择配送时段';

    for (const item of checkoutItems) {
      if (!item.skuId) {
        return '商品规格信息缺失，请返回重新选购';
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return '商品数量无效';
      }
    }

    return null;
  },

  buildDeliveryDateLabel(): string {
    const { deliveryDate, deliveryTimeBucket } = this.data;
    if (!deliveryDate) return '';
    return `${deliveryDate} ${deliveryTimeBucket}`;
  },

  onDeliveryDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ deliveryDate: e.detail.value as string });
  },

  onDeliveryTimeBucketChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    this.setData({
      deliveryTimeBucketIndex: index,
      deliveryTimeBucket: TIME_BUCKETS[index],
    });
  },

  onGreetingCardInput(e: WechatMiniprogram.Input) {
    this.setData({ greetingCard: e.detail.value });
  },

  buildCreatePayload() {
    const {
      receiverName,
      receiverPhone,
      deliveryAddress,
      greetingCard,
      checkoutItems,
    } = this.data;

    const totalAmount = Number(
      checkoutItems
        .reduce((sum, row) => sum + row.price * row.quantity, 0)
        .toFixed(2)
    );
    const deliveryFee = calcDeliveryFee(totalAmount);
    const payAmount = Number((totalAmount + deliveryFee).toFixed(2));

    const payload: {
      receiverName: string;
      receiverPhone: string;
      deliveryAddress: string;
      deliveryDate: string;
      greetingCard?: string;
      totalAmount: number;
      deliveryFee: number;
      payAmount: number;
      items: { skuId: string; quantity: number }[];
    } = {
      receiverName: receiverName.trim(),
      receiverPhone: receiverPhone.trim(),
      deliveryAddress: deliveryAddress.trim(),
      deliveryDate: this.buildDeliveryDateLabel(),
      totalAmount,
      deliveryFee,
      payAmount,
      items: checkoutItems.map((row) => ({
        skuId: row.skuId,
        quantity: row.quantity,
      })),
    };

    const card = greetingCard.trim();
    if (card) payload.greetingCard = card;

    return payload;
  },

  finishCheckout(purchasedSkuIds: string[] | null) {
    clearCheckoutStorageOnly();
    if (purchasedSkuIds?.length) {
      removePurchasedSkusFromCart(purchasedSkuIds);
    }
    wx.redirectTo({ url: '/pages/order-list/order-list' });
  },

  showMockPayModal(orderId: string, orderNo: string) {
    wx.showModal({
      title: '模拟支付',
      content:
        '提示：当前处于开发测试环境，点击【确认支付】将模拟完成资金扣款。',
      confirmText: '确认支付',
      cancelText: '暂不支付',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '支付处理中...', mask: true });
          const purchasedSkuIds = this.data.checkoutItems.map((r) => r.skuId);
          mockPayOrder(orderId)
            .then(() => {
              wx.hideLoading();
              wx.showToast({ title: '支付成功', icon: 'success' });
              setTimeout(() => this.finishCheckout(purchasedSkuIds), 800);
            })
            .catch(() => {
              wx.hideLoading();
              wx.showModal({
                title: '支付失败',
                content: '模拟支付未完成，可在订单列表中继续支付',
                showCancel: false,
                success: () => this.finishCheckout(null),
              });
            });
          return;
        }

        wx.showToast({
          title: '订单已保存至待支付列表',
          icon: 'none',
          duration: 2000,
        });
        setTimeout(() => this.finishCheckout(null), 600);
      },
    });
  },

  onSubmitOrder() {
    if (this.data.submitting) return;

    if (!isLoggedIn()) {
      wx.showModal({
        title: '请先登录',
        content: '提交订单需要微信登录，请重新打开小程序后再试。',
        showCancel: false,
      });
      return;
    }

    const formError = this.validateForm();
    if (formError) {
      wx.showToast({ title: formError, icon: 'none' });
      return;
    }

    const payload = this.buildCreatePayload();

    this.setData({ submitting: true });
    wx.showLoading({ title: '正在创建订单...', mask: true });

    createOrder(payload)
      .then((data) => {
        wx.hideLoading();
        if (!data?.orderId) {
          wx.showToast({ title: '创建订单失败', icon: 'none' });
          return;
        }
        this.showMockPayModal(data.orderId, data.orderNo);
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('创建订单失败', err);
        const errMsg =
          (err as { error?: string })?.error ||
          (typeof err === 'object' && err && 'message' in err
            ? String((err as { message?: string }).message)
            : '');
        wx.showModal({
          title: '下单失败',
          content: errMsg || '请稍后重试',
          showCancel: false,
        });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },
});
