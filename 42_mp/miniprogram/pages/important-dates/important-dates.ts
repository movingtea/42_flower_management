// pages/important-dates/important-dates.ts — 重要日期
import { fetchSavedRecipients, type SavedRecipient } from '../../utils/recipient-api';
import { isLoggedIn } from '../../utils/auth';
import { relationLabelByKey } from '../../utils/crm-options';

type DateItem = {
  id: string;
  name: string;
  relationLabel: string;
  dateType: '生日' | '纪念日';
  date: string;
  daysUntil: number | null;
};

function daysUntilDate(dateStr: string): number | null {
  if (!dateStr) return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length < 3) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let target = new Date(parts[0], parts[1] - 1, parts[2]);
  target.setHours(0, 0, 0, 0);
  if (Number.isNaN(target.getTime())) return null;

  const thisYear = new Date(today.getFullYear(), target.getMonth(), target.getDate());
  if (thisYear < today) {
    thisYear.setFullYear(today.getFullYear() + 1);
  }
  return Math.round((thisYear.getTime() - today.getTime()) / 86400000);
}

function buildDateItems(recipients: SavedRecipient[]): DateItem[] {
  const items: DateItem[] = [];

  for (const r of recipients) {
    if (r.birthday) {
      items.push({
        id: `${r.relationId}-birthday`,
        name: r.name,
        relationLabel: r.relationLabel || relationLabelByKey(r.relationType || ''),
        dateType: '生日',
        date: r.birthday,
        daysUntil: daysUntilDate(r.birthday),
      });
    }
    if (r.anniversary) {
      items.push({
        id: `${r.relationId}-anniversary`,
        name: r.name,
        relationLabel: r.relationLabel || relationLabelByKey(r.relationType || ''),
        dateType: '纪念日',
        date: r.anniversary,
        daysUntil: daysUntilDate(r.anniversary),
      });
    }
  }

  items.sort((a, b) => {
    if (a.daysUntil == null) return 1;
    if (b.daysUntil == null) return -1;
    return a.daysUntil - b.daysUntil;
  });

  return items;
}

Page({
  data: {
    loading: true,
    error: '',
    items: [] as DateItem[],
  },

  onShow() {
    void this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  async loadData() {
    if (!isLoggedIn()) {
      this.setData({ loading: false, error: '请先登录', items: [] });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      const data = await fetchSavedRecipients();
      const items = buildDateItems(data?.recipients ?? []);
      this.setData({ items, loading: false });
    } catch {
      this.setData({ loading: false, error: '加载失败，请下拉刷新' });
    }
  },

  onGoRecipients() {
    wx.navigateTo({ url: '/pages/recipients/recipients' });
  },
});
