/**
 * 小程序联调配置（真机调试请将 IP 改为电脑局域网地址）
 * baseUrl：Next.js 静态资源根（拼接 /uploads 等相对路径，末尾无斜杠）
 * apiMiniprogramBaseUrl：小程序业务 API 前缀（商品、订单、购物车等）
 * apiWechatBaseUrl：微信平台能力（登录、未来支付回调等）
 */
export const baseUrl = 'http://localhost:3000';

/** @deprecated 请使用 baseUrl */
export const assetBaseUrl = baseUrl;

/** 小程序业务数据 API */
export const apiMiniprogramBaseUrl = `${baseUrl}/api/miniprogram`;

/** 微信平台能力 API（登录 / 授权 / 支付回调） */
export const apiWechatBaseUrl = `${baseUrl}/api/wechat`;
