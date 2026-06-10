import { jsonSuccess } from "@/lib/api";
import { imageUrlFormatter } from "@/utils/imageUrlFormatter";

/** 小程序业务 API 统一成功响应：业务数据经图片路径清洗后再返回 */
export function jsonWechatSuccess<T>(data: T, status = 200) {
  return jsonSuccess(imageUrlFormatter(data), status);
}

/** @alias jsonWechatSuccess — 语义化命名，供 /api/miniprogram 路由使用 */
export const jsonMiniProgramSuccess = jsonWechatSuccess;
