// pages/checkout/checkout.ts — 结算履约与下单闭环
import { request } from '../../utils/request';

type FulfillmentMethod = 'DELIVERY' | 'PICKUP';

interface OrderItem {
  productId: string;
  skuId?: string;
  name: string;
  quantity: number;
  price: number;
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

interface CreateOrderApiResponse {
  success: boolean;
  data?: {
    message?: string;
    order?: {
      id: string;
      orderNo: string;
      status: string;
    };
  };
  error?: string;
}

const TIME_BUCKETS = ['上午', '下午', '晚上'];
const DEFAULT_SHIPPING_FEE = 15;

/** 今日 YYYY-MM-DD，供 date picker 的 start */
function todayString(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

Page({
  data: {
    fulfillmentMethod: 'DELIVERY' as FulfillmentMethod,
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
    orderItems: [] as OrderItem[],
    productTotal: 0,
    shippingFee: DEFAULT_SHIPPING_FEE,
    payableTotal: 0,
    submitting: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.initOrderItems(options);
    this.recalcAmounts();
  },

  /** 优先使用页面跳转参数，否则使用模拟商品便于联调 */
  initOrderItems(options: Record<string, string | undefined>) {
    const productId = options.productId || 'cmpgl54ob0000jwvwz0f1b8mu';
    const name = options.name ? decodeURIComponent(options.name) : '春日限定花束（联调）';
    const quantity = Math.max(1, parseInt(options.quantity || '1', 10) || 1);
    const price = parseFloat(options.price || '199') || 199;
    const skuId = options.skuId;

    const orderItems: OrderItem[] = [
      {
        productId,
        skuId,
        name,
        quantity,
        price,
      },
    ];

    const shippingFee =
      options.shippingFee !== undefined
        ? parseFloat(options.shippingFee) || 0
        : DEFAULT_SHIPPING_FEE;

    this.setData({ orderItems, shippingFee });
  },

  recalcAmounts() {
    const { orderItems, fulfillmentMethod, shippingFee } = this.data;
    const productTotal = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const fee = fulfillmentMethod === 'DELIVERY' ? shippingFee : 0;
    const payableTotal = productTotal + fee;
    this.setData({
      productTotal: Number(productTotal.toFixed(2)),
      shippingFee: fee,
      payableTotal: Number(payableTotal.toFixed(2)),
    });
  },

  onFulfillmentChange(e: WechatMiniprogram.TouchEvent) {
    const method = e.currentTarget.dataset.method as FulfillmentMethod;
    if (method === this.data.fulfillmentMethod) return;
    this.setData({ fulfillmentMethod: method }, () => {
      this.recalcAmounts();
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

  validateForm(): string | null {
    const {
      fulfillmentMethod,
      receiverName,
      receiverPhone,
      deliveryAddress,
      deliveryDate,
      deliveryTimeBucket,
      orderItems,
    } = this.data;

    if (!orderItems.length) {
      return '暂无待结算商品';
    }

    const nameLabel = fulfillmentMethod === 'DELIVERY' ? '收件人' : '联系人';
    if (!receiverName.trim()) return `请填写${nameLabel}姓名`;
    if (!receiverPhone.trim()) return '请填写联系电话';
    if (!/^1\d{10}$/.test(receiverPhone.trim())) return '请填写正确的手机号';

    if (fulfillmentMethod === 'DELIVERY') {
      if (!deliveryAddress.trim()) return '请填写详细收货地址';
    }

    if (!deliveryDate) return '请选择期望送达日期';
    if (!deliveryTimeBucket) return '请选择期望送达时段';

    for (const item of orderItems) {
      if (!item.productId || !item.productId.trim()) {
        return '商品信息不完整，请返回重新选购';
      }
      const qty = Math.floor(Number(item.quantity));
      if (!Number.isInteger(qty) || qty <= 0) {
        return '商品数量无效';
      }
      const price = Number(item.price);
      if (!Number.isFinite(price) || price < 0) {
        return '商品价格无效';
      }
    }

    return null;
  },

  /** 将日期 + 时段拼成后端可解析的 ISO 时间（对应 parseOrderBody 的 deliveryTime） */
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
   * 组装与后端 WechatCreateOrderPayload 完全对齐的请求体。
   * totalAmount 仅含商品行合计（与 items[].price * quantity 之和一致），不含配送费。
   */
  buildOrderPayload(wechatOpenId: string): WechatCreateOrderPayload {
    const {
      fulfillmentMethod,
      receiverName,
      receiverPhone,
      deliveryAddress,
      orderItems,
    } = this.data;

    const items = orderItems.map((item) => ({
      productId: String(item.productId).trim(),
      quantity: Math.floor(Number(item.quantity)),
      price: Number(Number(item.price).toFixed(2)),
    }));

    const totalAmount = Number(
      items.reduce((sum, row) => sum + row.price * row.quantity, 0).toFixed(2)
    );

    const payload: WechatCreateOrderPayload = {
      wechatOpenId: String(wechatOpenId).trim(),
      totalAmount,
      receiverName: receiverName.trim(),
      receiverPhone: receiverPhone.trim(),
      deliveryAddress:
        fulfillmentMethod === 'DELIVERY'
          ? deliveryAddress.trim()
          : '到店自提',
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

    const wechatOpenId = wx.getStorageSync('token');
    if (!wechatOpenId || typeof wechatOpenId !== 'string' || !String(wechatOpenId).trim()) {
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

    request<CreateOrderApiResponse>({
      url: '/orders',
      method: 'POST',
      data: orderData,
    })
      .then((res) => {
        wx.hideLoading();
        if (res?.success && res.data) {
          const orderNo = res.data.order?.orderNo;
          wx.showToast({
            title: orderNo ? `下单成功 ${orderNo}` : '下单成功',
            icon: 'success',
            duration: 2000,
          });
        } else {
          wx.showModal({
            title: '下单失败',
            content: res?.error || '未知错误',
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
