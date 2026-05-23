// pages/checkout/checkout.ts — 结算履约与下单闭环
import { baseUrl } from '../../config/index';
import { toRelativeImagePath } from '../../utils/image';
import { getOpenId, isLoggedIn } from '../../utils/auth';
import { request } from '../../utils/request';
import { fetchUserProfile, patchUserProfile } from '../../utils/user-api';
import {
  CHECKOUT_PRODUCTS_KEY,
  parseCartPrice,
  type CartItem,
} from '../../utils/cart';

/** 结算页展示行 */
interface CheckoutDisplayItem {
  id: string;
  name: string;
  price: number;
  priceText: string;
  quantity: number;
  shippingFee: number;
  shippingFeeLabel: string;
  lineSubtotal: string;
  imageUrl: string;
}

/** 与后端 POST /api/wechat/orders 的 parseOrderBody 字段一一对应 */
interface WechatCreateOrderPayload {
  wechatOpenId: string;
  totalAmount: number;
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  deliveryTime?: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
}

interface CreateOrderResult {
  message?: string;
  order?: {
    id: string;
    orderNo: string;
    status: string;
  };
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

/** 整单运费：勾选商品中单件运费的最大值 */
function calcOrderShippingFee(items: CheckoutDisplayItem[]): number {
  if (!items.length) return 0;
  return Math.max(...items.map((row) => row.shippingFee));
}

function cartRowsToDisplay(items: CartItem[]): CheckoutDisplayItem[] {
  return items.map((row) => {
    const price = parseCartPrice(row.price);
    const qty = Math.max(1, Math.floor(Number(row.quantity)) || 1);
    const shippingFee = Math.max(0, Number(row.shippingFee) || 0);
    const lineSubtotal = price * qty;

    return {
      id: row.id,
      name: row.name,
      price,
      priceText: formatMoney(price),
      quantity: qty,
      shippingFee,
      shippingFeeLabel:
        shippingFee > 0 ? `¥${formatMoney(shippingFee)}` : '免运费',
      lineSubtotal: formatMoney(lineSubtotal),
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
    isAnonymous: false,
    checkoutItems: [] as CheckoutDisplayItem[],
    productTotal: '0.00',
    shippingFee: '0.00',
    payableTotal: '0.00',
    submitting: false,
    emptyCheckout: true,
    baseUrl,
  },

  onLoad() {
    this.loadCheckoutProducts();
    void this.prefillDefaultAddress();
  },

  onShow() {
    this.loadCheckoutProducts();
    void this.prefillDefaultAddress();
  },

  /** 拉取用户默认收货信息回填 */
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

  /** 微信收货地址一键导入 */
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
        }).catch(() => {
          /* 本地已回填，同步失败不阻断 */
        });

        wx.showToast({ title: '地址已导入', icon: 'success' });
      },
      fail: (err) => {
        const msg = (err as { errMsg?: string }).errMsg ?? '';
        if (msg.includes('cancel')) return;
        wx.showToast({ title: '未能获取微信地址', icon: 'none' });
      },
    });
  },

  /** 从购物车勾选缓存加载待结算商品 */
  loadCheckoutProducts() {
    let raw: unknown;
    try {
      raw = wx.getStorageSync(CHECKOUT_PRODUCTS_KEY);
    } catch (err) {
      console.warn('读取结算缓存失败', err);
      raw = null;
    }

    if (!Array.isArray(raw) || raw.length === 0) {
      this.setData({
        checkoutItems: [],
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
    const shippingFeeNum = calcOrderShippingFee(list);
    const payableTotalNum = productTotalNum + shippingFeeNum;

    this.setData({
      productTotal: formatMoney(productTotalNum),
      shippingFee: formatMoney(shippingFeeNum),
      payableTotal: formatMoney(payableTotalNum),
    });
  },

  onReceiverNameInput(e: WechatMiniprogram.Input) {
    this.setData({ receiverName: e.detail.value });
  },

  onReceiverPhoneInput(e: WechatMiniprogram.Input) {
    this.setData({ receiverPhone: e.detail.value });
  },

  onDeliveryAddressInput(e: WechatMiniprogram.Input) {
    this.setData({ deliveryAddress: e.detail.value });
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

  onAnonymousChange(e: WechatMiniprogram.CheckboxGroupChange) {
    const checked = (e.detail.value as string[]).includes('anonymous');
    this.setData({ isAnonymous: checked });
  },

  onGoCart() {
    wx.switchTab({ url: '/pages/cart/cart' });
  },

  validateForm(): string | null {
    const {
      receiverName,
      receiverPhone,
      deliveryAddress,
      deliveryDate,
      deliveryTimeBucket,
      checkoutItems,
      emptyCheckout,
    } = this.data;

    if (emptyCheckout || !checkoutItems.length) {
      return '暂无待结算商品，请返回购物车勾选';
    }

    if (!receiverName.trim()) return '请填写收件人姓名';
    if (!receiverPhone.trim()) return '请填写联系电话';
    if (!/^1\d{10}$/.test(receiverPhone.trim())) return '请填写正确的手机号';
    if (!deliveryAddress.trim()) return '请填写详细收货地址';
    if (!deliveryDate) return '请选择期望送达日期';
    if (!deliveryTimeBucket) return '请选择期望送达时段';

    for (const item of checkoutItems) {
      if (!item.id || !item.id.trim()) {
        return '商品信息不完整，请返回重新选购';
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return '商品数量无效';
      }
      if (!Number.isFinite(item.price) || item.price < 0) {
        return '商品价格无效';
      }
    }

    return null;
  },

  buildDeliveryTimeIso(): string | undefined {
    const { deliveryDate, deliveryTimeBucket } = this.data;
    if (!deliveryDate) return undefined;

    const hourMap: Record<string, number> = {
      上午: 10,
      下午: 14,
      晚上: 18,
    };
    const hour = hourMap[deliveryTimeBucket] ?? 12;
    const iso = new Date(`${deliveryDate}T${String(hour).padStart(2, '0')}:00:00`);
    if (Number.isNaN(iso.getTime())) return undefined;
    return iso.toISOString();
  },

  /**
   * 组装与后端 WechatCreateOrderPayload 对齐的请求体。
   * totalAmount 仅含商品行合计（不含运费），与历史接口约定一致。
   */
  buildOrderPayload(wechatOpenId: string): WechatCreateOrderPayload {
    const { receiverName, receiverPhone, deliveryAddress, checkoutItems } =
      this.data;

    const items = checkoutItems.map((item) => ({
      productId: String(item.id).trim(),
      quantity: item.quantity,
      price: Number(item.price.toFixed(2)),
    }));

    const totalAmount = Number(
      items.reduce((sum, row) => sum + row.price * row.quantity, 0).toFixed(2)
    );

    const payload: WechatCreateOrderPayload = {
      wechatOpenId: String(wechatOpenId).trim(),
      totalAmount,
      receiverName: receiverName.trim(),
      receiverPhone: receiverPhone.trim(),
      deliveryAddress: deliveryAddress.trim(),
      items,
    };

    const deliveryTime = this.buildDeliveryTimeIso();
    if (deliveryTime) {
      payload.deliveryTime = deliveryTime;
    }

    return payload;
  },

  onSubmitOrder() {
    if (this.data.submitting) return;

    const wechatOpenId = getOpenId();
    if (!wechatOpenId || !String(wechatOpenId).trim()) {
      wx.showModal({
        title: '登录态失效',
        content:
          '本地未找到身份凭证，请尝试在开发者工具中「清除缓存」并重新编译小程序。',
        showCancel: false,
      });
      return;
    }

    const formError = this.validateForm();
    if (formError) {
      wx.showToast({ title: formError, icon: 'none' });
      return;
    }

    const orderData = this.buildOrderPayload(wechatOpenId);

    this.setData({ submitting: true });
    wx.showLoading({ title: '正在提交订单...', mask: true });

    request<CreateOrderResult>({
      url: '/orders',
      method: 'POST',
      data: orderData as WechatMiniprogram.IAnyObject,
    })
      .then((data) => {
        wx.hideLoading();
        if (data?.order) {
          const orderNo = data.order.orderNo;
          wx.showToast({
            title: orderNo ? `下单成功 ${orderNo}` : '下单成功',
            icon: 'success',
            duration: 2000,
          });
        } else {
          wx.showModal({
            title: '下单失败',
            content: data?.message || '未知错误',
            showCancel: false,
          });
        }
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('下单请求失败：', err);
        const errMsg =
          err?.data?.error ||
          (typeof err?.data === 'object' && err.data && 'error' in err.data
            ? String((err.data as { error?: string }).error)
            : '');
        if (errMsg) {
          wx.showModal({
            title: '下单失败',
            content: errMsg,
            showCancel: false,
          });
        }
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },
});
