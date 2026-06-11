import { apiMiniprogramBaseUrl } from '../config/index';
import { getToken } from './auth';
import { resolveApiErrorMessage, type ApiErrorBody } from './business-error';

const BASE_URL = apiMiniprogramBaseUrl;

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

type WxRequestData = string | WechatMiniprogram.IAnyObject | ArrayBuffer;

export interface ApiResponse<T> {
  success: boolean;
  ok?: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
}

interface RequestOptions {
  url: string;
  method?: Method;
  data?: WxRequestData;
  header?: Record<string, string>;
  /** 为 true 时不自动解包 data（如登录前请求） */
  raw?: boolean;
  /** 为 true 时失败不自动 toast，由调用方处理 */
  quiet?: boolean;
}

/**
 * 微信 API 请求封装。默认将 `{ success, data }` 解包，泛型 `T` 为 `data` 的业务类型，不是 `ApiResponse<T>`。
 */
export const request = <T = unknown>(options: RequestOptions): Promise<T> => {
  const { url, method = 'GET', data, header = {}, raw = false, quiet = false } = options;
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
          const body = (res.data as ApiErrorBody | undefined) ?? {
            success: false,
            error: `服务异常: ${res.statusCode}`,
          };
          const message = resolveApiErrorMessage(body);
          if (!quiet) {
            wx.showToast({
              title: message,
              icon: 'none',
            });
          }
          reject({ ...body, message, error: message });
          return;
        }

        if (raw) {
          resolve(res.data as T);
          return;
        }

        const body = res.data as ApiResponse<T>;
        if (!body?.success) {
          const message = resolveApiErrorMessage(body);
          if (!quiet) {
            wx.showToast({
              title: message,
              icon: 'none',
            });
          }
          reject({ ...body, message, error: message });
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
