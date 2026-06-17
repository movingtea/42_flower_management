// pages/order-list/order-list.ts — 我的订单
import { baseUrl } from '../../config/index';
import { isLoggedIn } from '../../utils/auth';
import { resolveApiErrorMessage } from '../../utils/business-error';
import { normalizeImageUrl } from '../../utils/image';
import {
  cancelPendingOrder,
  confirmOrderReceipt,
  fetchMyOrders,
  mockPayOrder,
  ORDER_STATUS_LABEL,
  type OrderListItem,
} from '../../utils/order-api';
import {
  computeExpiresAtIso,
  formatCountdownMmSs,
  getPaymentRemainingMs,
  isPaymentExpired,
} from '../../utils/order-timer';

type OrderCard = OrderListItem & {
  payAmountText: string;
  createdAtText: string;
  expiresAt: string | null;
  countdownText: string;
  countdownExpired: boolean;
  showPay: boolean;
  showCancel: boolean;
  items: Array<
    OrderListItem['items'][number] & {
      imageUrl: string;
      snapshotPrice: string;
    }
  >;
};

const timerIds = new Map<string, number>();

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  const h = `${d.getHours()}`.padStart(2, '0');
  const min = `${d.getMinutes()}`.padStart(2, '0');
  return `${m}-${day} ${h}:${min}`;
}

function decorateOrder(o: OrderListItem): OrderCard {
  const expiresAt =
    o.status === 'PENDING_PAYMENT'
      ? o.expiresAt ?? computeExpiresAtIso(o.createdAt)
      : null;
  const remaining = expiresAt ? getPaymentRemainingMs(expiresAt) : 0;
  const expired =
    o.status === 'PENDING_PAYMENT' && expiresAt
      ? isPaymentExpired(expiresAt)
      : false;

  return {
    ...o,
    statusLabel:
      expired && o.status === 'PENDING_PAYMENT'
        ? '已超时关闭'
        : o.statusLabel || ORDER_STATUS_LABEL[o.status] || o.status,
    payAmountText: Number(o.payAmount).toFixed(2),
    createdAtText: formatDate(o.createdAt),
    expiresAt,
    countdownText: formatCountdownMmSs(remaining),
    countdownExpired: expired,
    showPay: o.status === 'PENDING_PAYMENT' && !expired,
    showCancel: o.status === 'PENDING_PAYMENT' && !expired,
    items: o.items.map((line) => ({
      ...line,
      imageUrl: normalizeImageUrl(line.snapshotImageUrl),
      snapshotPrice: Number(line.snapshotPrice).toFixed(2),
    })),
  };
}

Page({
  data: {
    baseUrl,
    loading: true,
    orders: [] as OrderCard[],
  },

  onShow() {
    void this.loadOrders();
  },

  onHide() {
    this.clearAllTimers();
  },

  onUnload() {
    this.clearAllTimers();
  },

  onPullDownRefresh() {
    void this.loadOrders().finally(() => wx.stopPullDownRefresh());
  },

  clearAllTimers() {
    for (const id of timerIds.values()) {
      clearInterval(id);
    }
    timerIds.clear();
  },

  startCountdownTimers(orders: OrderCard[]) {
    this.clearAllTimers();
    for (const order of orders) {
      if (order.status !== 'PENDING_PAYMENT' || !order.expiresAt) continue;
      const timer = setInterval(() => {
        const remaining = getPaymentRemainingMs(order.expiresAt!);
        if (remaining <= 0) {
          clearInterval(timer);
          timerIds.delete(order.id);
          void this.loadOrders();
          return;
        }
        const key = `orders`;
        const list = (this.data.orders as OrderCard[]).map((row) =>
          row.id === order.id
            ? { ...row, countdownText: formatCountdownMmSs(remaining) }
            : row
        );
        this.setData({ [key]: list });
      }, 1000);
      timerIds.set(order.id, timer as unknown as number);
    }
  },

  async loadOrders() {
    if (!isLoggedIn()) {
      this.setData({ loading: false, orders: [] });
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    try {
      const data = await fetchMyOrders();
      const orders = (data?.orders ?? []).map(decorateOrder);
      this.setData({
        orders,
        loading: false,
      });
      this.startCountdownTimers(orders);
    } catch {
      this.setData({ loading: false, orders: [] });
      wx.showToast({ title: '加载订单失败', icon: 'none' });
    }
  },

  onGoHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  onPayOrder(e: WechatMiniprogram.TouchEvent) {
    const orderId = (e.currentTarget.dataset as { id?: string }).id;
    if (!orderId) return;

    wx.showLoading({ title: '支付中...', mask: true });
    mockPayOrder(orderId)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '支付成功', icon: 'success' });
        void this.loadOrders();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({
          title: resolveApiErrorMessage(err),
          icon: 'none',
        });
      });
  },

  onCancelOrder(e: WechatMiniprogram.TouchEvent) {
    const orderId = (e.currentTarget.dataset as { id?: string }).id;
    if (!orderId) return;

    wx.showModal({
      title: '取消订单',
      content: '确定取消这个订单吗？取消后需要重新下单。',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '取消中...', mask: true });
        cancelPendingOrder(orderId)
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: '订单已取消', icon: 'success' });
            void this.loadOrders();
          })
          .catch((err) => {
            wx.hideLoading();
            wx.showToast({
              title: resolveApiErrorMessage(err),
              icon: 'none',
            });
          });
      },
    });
  },

  onConfirmReceipt(e: WechatMiniprogram.TouchEvent) {
    const orderId = (e.currentTarget.dataset as { id?: string }).id;
    if (!orderId) return;

    wx.showModal({
      title: '确认收货',
      content: '确认已收到商品？',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '提交中...', mask: true });
        confirmOrderReceipt(orderId)
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: '已确认收货', icon: 'success' });
            void this.loadOrders();
          })
          .catch((err) => {
            wx.hideLoading();
            wx.showToast({
              title: resolveApiErrorMessage(err),
              icon: 'none',
            });
          });
      },
    });
  },
});
