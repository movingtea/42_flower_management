/// <reference path="./types/index.d.ts" />

/** 后端下发的用户信息 */
interface AppGlobalUser {
  openId?: string;
  nickName?: string;
  avatarUrl?: string;
  phone?: string;
}

interface IAppOption {
  globalData: {
    userInfo?: AppGlobalUser;
    baseUrl: string;
  };
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback;
  /** 静默登录（App 实例方法，必填以实现类型安全） */
  performSilentLogin(): void;
}
