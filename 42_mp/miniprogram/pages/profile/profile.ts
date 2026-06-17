// pages/profile/profile.ts — 头像昵称自愿填写
import { apiMiniprogramBaseUrl } from '../../config/index';
import { getToken, setStoredUser } from '../../utils/auth';
import { normalizeImageUrl } from '../../utils/image';
import { fetchUserProfile, patchUserProfile } from '../../utils/user-api';
import type { WechatUserProfile } from '../../utils/user';

Page({
  data: {
    nickName: '',
    avatarUrl: '',
    avatarDisplay: '',
    saving: false,
  },

  onShow() {
    void this.loadProfile();
  },

  async loadProfile() {
    try {
      const data = await fetchUserProfile();
      const user = data?.user;
      if (!user) return;
      this.applyUser(user);
      setStoredUser(user);
    } catch {
      /* 未登录时 request 已提示 */
    }
  },

  applyUser(user: WechatUserProfile) {
    const avatarDisplay = user.avatarUrl
      ? normalizeImageUrl(user.avatarUrl)
      : '';
    this.setData({
      nickName: user.nickName ?? '',
      avatarUrl: user.avatarUrl ?? '',
      avatarDisplay,
    });
  },

  onChooseAvatar(e: WechatMiniprogram.CustomEvent) {
    const tempPath = (e.detail as { avatarUrl?: string }).avatarUrl;
    if (!tempPath) return;

    const token = getToken();
    if (!token) {
      wx.showToast({ title: '请先完成登录', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '上传中…', mask: true });

    wx.uploadFile({
      url: `${apiMiniprogramBaseUrl}/upload`,
      filePath: tempPath,
      name: 'file',
      header: {
        Authorization: `Bearer ${token}`,
      },
      success: (res) => {
        wx.hideLoading();
        try {
          const body = JSON.parse(res.data) as {
            success?: boolean;
            data?: { url?: string; objectKey?: string; path?: string };
            error?: string;
          };
          if (!body.success || !body.data?.url) {
            wx.showToast({
              title: body.error || '上传失败',
              icon: 'none',
            });
            return;
          }

          const storedKey =
            body.data.objectKey ?? body.data.path ?? body.data.url ?? '';
          const avatarDisplay = normalizeImageUrl(body.data.url);
          this.setData({
            avatarUrl: storedKey,
            avatarDisplay,
          });
          void this.syncProfile({ avatarUrl: storedKey });
        } catch {
          wx.showToast({ title: '上传响应解析失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '头像上传失败', icon: 'none' });
      },
    });
  },

  onNickNameBlur(e: WechatMiniprogram.InputBlur) {
    const nickName = (e.detail.value ?? '').trim();
    if (nickName === this.data.nickName) return;
    this.setData({ nickName });
    void this.syncProfile({ nickName });
  },

  async syncProfile(
    patch: Partial<Pick<WechatUserProfile, 'nickName' | 'avatarUrl'>>
  ) {
    if (this.data.saving) return;
    this.setData({ saving: true });

    try {
      const data = await patchUserProfile(patch);
      if (data?.user) {
        this.applyUser(data.user);
        setStoredUser(data.user);
        const app = getApp<IAppOption>();
        if (app.globalData) {
          app.globalData.userInfo = {
            openId: data.user.openId,
            nickName: data.user.nickName ?? undefined,
            avatarUrl: data.user.avatarUrl ?? undefined,
          };
        }
      }
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch {
      /* request 已提示 */
    } finally {
      this.setData({ saving: false });
    }
  },
});
