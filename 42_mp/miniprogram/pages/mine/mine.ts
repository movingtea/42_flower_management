// pages/mine/mine.ts — 个人中心入口
import { getStoredUser, isLoggedIn } from '../../utils/auth';
import { normalizeImageUrl } from '../../utils/image';

Page({
  data: {
    loggedIn: false,
    nickName: '微信用户',
    avatarDisplay: '',
  },

  onShow() {
    const user = getStoredUser();
    const loggedIn = isLoggedIn();

    let nickName = '点击完善资料';
    let avatarDisplay = '';

    if (user) {
      nickName = user.nickName || '点击完善昵称';
      if (user.avatarUrl) {
        avatarDisplay = normalizeImageUrl(user.avatarUrl);
      }
    }

    this.setData({ loggedIn, nickName, avatarDisplay });
  },

  onGoProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  onGoOrders() {
    wx.navigateTo({ url: '/pages/order-list/order-list' });
  },

  onGoRecipients() {
    wx.navigateTo({ url: '/pages/recipients/recipients' });
  },

  onGoImportantDates() {
    wx.navigateTo({ url: '/pages/important-dates/important-dates' });
  },
});
