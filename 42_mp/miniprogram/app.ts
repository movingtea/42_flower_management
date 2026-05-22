// app.ts — 应用入口：静默登录打通 Next.js 后端
import { request } from './utils/request';

/** 后端 /login 接口返回结构 */
interface LoginResponse {
  token: string;
  userInfo: AppGlobalUser;
}

App<IAppOption>({
  globalData: {
    userInfo: undefined,
  },

  onLaunch() {
    this.performSilentLogin();
  },

  /** 无感登录：wx.login 换取 code，POST 至 Next.js 后端 */
  performSilentLogin() {
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          console.error('wx.login 未返回 code', loginRes.errMsg);
          return;
        }

        request<LoginResponse>({
          url: '/login',
          method: 'POST',
          data: { code: loginRes.code },
        })
          .then((res) => {
            if (res.token) {
              wx.setStorageSync('token', res.token);
            }
            if (res.userInfo) {
              this.globalData.userInfo = res.userInfo;
            }
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
