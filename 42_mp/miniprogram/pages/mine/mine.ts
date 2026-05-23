// pages/mine/mine.ts — 个人中心入口
import { baseUrl } from '../../config/index';
import { getStoredUser, isLoggedIn } from '../../utils/auth';
import { toRelativeImagePath } from '../../utils/image';
Page({
  data: {
    baseUrl,
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
        const path = toRelativeImagePath(user.avatarUrl);
        avatarDisplay = `${baseUrl}${path}`;
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
});
