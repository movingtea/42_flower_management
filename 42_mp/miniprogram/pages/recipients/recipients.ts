// pages/recipients/recipients.ts — 我的收花人
import { isLoggedIn } from '../../utils/auth';
import {
  fetchSavedRecipients,
  createRecipient,
  updateRecipient,
  deleteRecipient,
  type SavedRecipient,
} from '../../utils/recipient-api';
import {
  RELATION_OPTIONS,
  relationLabelByKey,
} from '../../utils/crm-options';

type FormState = {
  name: string;
  phone: string;
  address: string;
  relationIndex: number;
  preferredColors: string;
  dislikedFlowers: string;
  preferenceNote: string;
  birthday: string;
  anniversary: string;
};

function emptyForm(): FormState {
  return {
    name: '',
    phone: '',
    address: '',
    relationIndex: -1,
    preferredColors: '',
    dislikedFlowers: '',
    preferenceNote: '',
    birthday: '',
    anniversary: '',
  };
}

Page({
  data: {
    loading: true,
    error: '',
    recipients: [] as SavedRecipient[],
    showForm: false,
    editingId: '',
    form: emptyForm(),
    relationOptions: RELATION_OPTIONS.map((o) => o.label),
    relationKeys: RELATION_OPTIONS.map((o) => o.key),
    submitting: false,
  },

  onShow() {
    void this.loadList();
  },

  async loadList() {
    if (!isLoggedIn()) {
      this.setData({ loading: false, recipients: [], error: '请先登录' });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      const data = await fetchSavedRecipients();
      this.setData({
        recipients: data?.recipients ?? [],
        loading: false,
      });
    } catch {
      this.setData({
        loading: false,
        error: '加载失败，请下拉刷新重试',
      });
    }
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
  },

  onAddTap() {
    this.setData({
      showForm: true,
      editingId: '',
      form: emptyForm(),
    });
  },

  onEditTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const item = this.data.recipients.find((r) => r.relationId === id);
    if (!item) return;

    const relationIndex = this.data.relationKeys.indexOf(item.relationType || '');

    this.setData({
      showForm: true,
      editingId: id,
      form: {
        name: item.name || '',
        phone: item.phone || '',
        address: item.address || '',
        relationIndex: relationIndex >= 0 ? relationIndex : -1,
        preferredColors: item.preferredColors || '',
        dislikedFlowers: item.dislikedFlowers || '',
        preferenceNote: item.preferenceNote || '',
        birthday: item.birthday || '',
        anniversary: item.anniversary || '',
      },
    });
  },

  onDeleteTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const item = this.data.recipients.find((r) => r.relationId === id);
    if (!id || !item) return;

    wx.showModal({
      title: '删除常用收花人',
      content: `确定删除「${item.name}」吗？删除后不会影响历史订单记录。`,
      success: (res) => {
        if (!res.confirm) return;
        deleteRecipient(id)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            void this.loadList();
          })
          .catch(() => {
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
      },
    });
  },

  onCloseForm() {
    this.setData({ showForm: false, editingId: '', form: emptyForm() });
  },

  onFormSheetTap() {
    /* 阻止点击表单时关闭蒙层 */
  },

  onFormInput(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field as keyof FormState;
    if (!field) return;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onRelationChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'form.relationIndex': Number(e.detail.value) });
  },

  onBirthdayChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'form.birthday': e.detail.value as string });
  },

  onAnniversaryChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'form.anniversary': e.detail.value as string });
  },

  async onSaveForm() {
    const { form, editingId, relationKeys, submitting } = this.data;
    if (submitting) return;

    const name = form.name.trim();
    if (!name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }

    const relationType = form.relationIndex >= 0 ? relationKeys[form.relationIndex] : undefined;
    const payload = {
      name,
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      relationType,
      relationLabel: relationType ? relationLabelByKey(relationType) : undefined,
      preferredColors: form.preferredColors.trim() || undefined,
      dislikedFlowers: form.dislikedFlowers.trim() || undefined,
      preferenceNote: form.preferenceNote.trim() || undefined,
      birthday: form.birthday.trim() || undefined,
      anniversary: form.anniversary.trim() || undefined,
    };

    this.setData({ submitting: true });
    try {
      if (editingId) {
        await updateRecipient(editingId, payload);
        wx.showToast({ title: '已更新', icon: 'success' });
      } else {
        await createRecipient(payload);
        wx.showToast({ title: '已添加', icon: 'success' });
      }
      this.setData({ showForm: false, editingId: '', form: emptyForm() });
      await this.loadList();
    } catch {
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
