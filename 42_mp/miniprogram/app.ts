// app.ts — 应用入口：静默登录
import { baseUrl } from './config/index';
import { request } from './utils/request';
import { setOpenId, setStoredUser, setToken } from './utils/auth';
import type { WechatUserProfile } from './utils/user';

App<IAppOption>({
  globalData: {
    userInfo: undefined,
    baseUrl,
  },

  onLaunch() {
    this.performSilentLogin();
  },

  /** 无感登录：wx.login → /auth/login → 缓存 token 与 openId */
  performSilentLogin() {
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          console.error('wx.login 未返回 code', loginRes.errMsg);
          return;
        }

        request<{ token: string; user: WechatUserProfile }>({
          url: '/auth/login',
          method: 'POST',
          data: { code: loginRes.code },
        })
          .then((data) => {
            if (!data?.token || !data?.user?.openId) {
              console.warn('登录响应缺少 token 或 openId');
              return;
            }

            setToken(data.token);
            setOpenId(data.user.openId);
            setStoredUser(data.user);

            const userInfo: AppGlobalUser = {
              openId: data.user.openId,
              nickName: data.user.nickName ?? undefined,
              avatarUrl: data.user.avatarUrl ?? undefined,
            };
            this.globalData.userInfo = userInfo;
          })
          .catch((err) => {
            console.error('静默登录失败', err);
          });
      },
      fail: (err) => {
        console.error('wx.login 调用失败', err);
      },
    });
  },
});
