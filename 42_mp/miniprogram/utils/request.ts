// utils/request.ts
// 本地联调环境下指向 Next.js 后端服务。如果是在真机调试，请将 localhost 改为你的电脑局域网 IP (如 192.168.x.x)
const BASE_URL = 'http://192.168.31.200:3000/api/wechat';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface RequestOptions {
  url: string;
  method?: Method;
  data?: any;
  header?: Record<string, string>;
}

export const request = <T = any>(options: RequestOptions): Promise<T> => {
  const { url, method = 'GET', data, header = {} } = options;

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method: method as WechatMiniprogram.RequestOption['method'],
      data,
      header: {
        'content-type': 'application/json',
        ...header
      },
      success: (res) => {
        // 微信小程序标准的请求成功回调
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else {
          wx.showToast({
            title: `服务异常: ${res.statusCode}`,
            icon: 'error'
          });
          reject(res);
        }
      },
      fail: (err) => {
        wx.showToast({
          title: '网络连接失败',
          icon: 'error'
        });
        reject(err);
      }
    });
  });
};
