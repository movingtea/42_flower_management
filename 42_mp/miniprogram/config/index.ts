/**
 * 小程序联调配置（真机调试请将 IP 改为电脑局域网地址）
 * baseUrl：Next.js 站点根（占位图 /images 等静态资源，末尾无斜杠）
 * ossPublicBaseUrl：OSS 业务图片公网域名（与 ALIYUN_OSS_PUBLIC_BASE_URL 一致）
 * apiMiniprogramBaseUrl：小程序业务 API 前缀（商品、订单、购物车等）
 * apiWechatBaseUrl：微信平台能力（登录、未来支付回调等）
 */
export const baseUrl = 'https://www.universe42.studio';

/** OSS 业务图片公网域名（image 组件远程业务图） */
export const ossPublicBaseUrl = 'https://oss.universe42.studio';

/** OSS objectKey 前缀（与 ALIYUN_OSS_OBJECT_PREFIX 一致） */
export const ossObjectPrefix = 'universe42';

/** @deprecated 请使用 baseUrl */
export const assetBaseUrl = baseUrl;

/** 小程序业务数据 API */
export const apiMiniprogramBaseUrl = `${baseUrl}/api/miniprogram`;

/** 微信平台能力 API（登录 / 授权 / 支付回调） */
export const apiWechatBaseUrl = `${baseUrl}/api/wechat`;
