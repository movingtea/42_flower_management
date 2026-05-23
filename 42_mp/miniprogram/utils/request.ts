import { apiWechatBaseUrl } from '../config/index';
import { getToken } from './auth';

const BASE_URL = apiWechatBaseUrl;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type WxRequestData = string | WechatMiniprogram.IAnyObject | ArrayBuffer;

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface RequestOptions {
  url: string;
  method?: Method;
  data?: WxRequestData;
  header?: Record<string, string>;
  /** 为 true 时不自动解包 data（如登录前请求） */
  raw?: boolean;
}

/**
 * 微信 API 请求封装。默认将 `{ success, data }` 解包，泛型 `T` 为 `data` 的业务类型，不是 `ApiResponse<T>`。
 */
export const request = <T = unknown>(options: RequestOptions): Promise<T> => {
  const { url, method = 'GET', data, header = {}, raw = false } = options;
  const token = getToken();

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method: method as WechatMiniprogram.RequestOption['method'],
      data,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...header,
      },
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const body = res.data as ApiResponse<unknown> | undefined;
          wx.showToast({
            title: body?.error || `服务异常: ${res.statusCode}`,
            icon: 'none',
          });
          reject(res);
          return;
        }

        if (raw) {
          resolve(res.data as T);
          return;
        }

        const body = res.data as ApiResponse<T>;
        if (!body?.success) {
          wx.showToast({
            title: body?.error || '请求失败',
            icon: 'none',
          });
          reject(body);
          return;
        }

        resolve(body.data as T);
      },
      fail: (err) => {
        wx.showToast({
          title: '网络连接失败',
          icon: 'none',
        });
        reject(err);
      },
    });
  });
};
