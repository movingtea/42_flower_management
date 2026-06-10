import { apiWechatBaseUrl } from '../config/index';
import type { WechatUserProfile } from './user';

type LoginResponse = {
  success: boolean;
  data?: { token: string; user: WechatUserProfile };
  error?: string;
};

/** 微信登录：POST /api/wechat/auth/login（不走业务 API 前缀） */
export function loginWithWechatCode(code: string): Promise<{ token: string; user: WechatUserProfile }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiWechatBaseUrl}/auth/login`,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: { code },
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const body = res.data as LoginResponse | undefined;
          reject(new Error(body?.error ?? `登录失败: ${res.statusCode}`));
          return;
        }
        const body = res.data as LoginResponse;
        if (!body?.success || !body.data?.token || !body.data?.user?.openId) {
          reject(new Error(body?.error ?? '登录响应无效'));
          return;
        }
        resolve(body.data);
      },
      fail: (err) => reject(err),
    });
  });
}
