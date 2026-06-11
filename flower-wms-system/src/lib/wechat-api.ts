import { NextResponse } from "next/server";
import { jsonSuccess } from "@/lib/api";
import type { MiniprogramErrorCode } from "@/lib/miniprogram-business-error";
import { imageUrlFormatter } from "@/utils/imageUrlFormatter";

/** 小程序业务 API 统一成功响应：业务数据经图片路径清洗后再返回 */
export function jsonWechatSuccess<T>(data: T, status = 200) {
  return jsonSuccess(imageUrlFormatter(data), status);
}

/** 小程序业务 API 统一错误响应（含业务错误码） */
export function jsonWechatError(
  message: string,
  status = 400,
  code?: MiniprogramErrorCode
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(code ? { code } : {}),
    },
    { status }
  );
}

/** @alias jsonWechatSuccess — 语义化命名，供 /api/miniprogram 路由使用 */
export const jsonMiniProgramSuccess = jsonWechatSuccess;
