// pages/order-list/order-list.ts — 我的订单
import { baseUrl } from '../../config/index';
import { isLoggedIn } from '../../utils/auth';
import { toRelativeImagePath } from '../../utils/image';
import {
  confirmOrderReceipt,
  fetchMyOrders,
  ORDER_STATUS_LABEL,
  type OrderListItem,
} from '../../utils/order-api';

type OrderCard = OrderListItem & {
  payAmountText: string;
  createdAtText: string;
  items: Array<
    OrderListItem['items'][number] & {
      imageUrl: string;
      snapshotPrice: string;
    }
  >;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  const h = `${d.getHours()}`.padStart(2, '0');
  const min = `${d.getMinutes()}`.padStart(2, '0');
  return `${m}-${day} ${h}:${min}`;
}

function mapOrders(rows: OrderListItem[]): OrderCard[] {
  return rows.map((o) => ({
    ...o,
    statusLabel: o.statusLabel || ORDER_STATUS_LABEL[o.status] || o.status,
    payAmountText: Number(o.payAmount).toFixed(2),
    createdAtText: formatDate(o.createdAt),
    items: o.items.map((line) => ({
      ...line,
      imageUrl: toRelativeImagePath(line.snapshotImageUrl),
      snapshotPrice: Number(line.snapshotPrice).toFixed(2),
    })),
  }));
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

  onPullDownRefresh() {
    void this.loadOrders().finally(() => wx.stopPullDownRefresh());
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
      this.setData({
        orders: mapOrders(data?.orders ?? []),
        loading: false,
      });
    } catch {
      this.setData({ loading: false, orders: [] });
      wx.showToast({ title: '加载订单失败', icon: 'none' });
    }
  },

  onGoHome() {
    wx.switchTab({ url: '/pages/index/index' });
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
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          });
      },
    });
  },
});
