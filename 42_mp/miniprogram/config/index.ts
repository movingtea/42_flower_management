/**
 * 小程序联调配置（真机调试请将 IP 改为电脑局域网地址）
 * baseUrl：Next.js 静态资源根（拼接 /uploads 等相对路径，末尾无斜杠）
 * apiWechatBaseUrl：微信 API 前缀
 */
export const baseUrl = 'https://www.universe42.studio';

/** @deprecated 请使用 baseUrl */
export const assetBaseUrl = baseUrl;

export const apiWechatBaseUrl = `${baseUrl}/api/wechat`;
