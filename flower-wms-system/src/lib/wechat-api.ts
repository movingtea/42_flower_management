import { jsonSuccess } from "@/lib/api";
import { imageUrlFormatter } from "@/utils/imageUrlFormatter";

/** 小程序 API 统一成功响应：业务数据经图片路径清洗后再返回 */
export function jsonWechatSuccess<T>(data: T, status = 200) {
  return jsonSuccess(imageUrlFormatter(data), status);
}
