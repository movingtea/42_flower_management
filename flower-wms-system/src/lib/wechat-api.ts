import { NextResponse } from "next/server";
import { jsonSuccess } from "@/lib/api";
import {
  buildBusinessErrorBody,
  type MiniprogramErrorCode,
} from "@/lib/business-errors";
import { imageUrlFormatter } from "@/utils/imageUrlFormatter";

/** 小程序业务 API 统一成功响应：业务数据经图片路径清洗后再返回 */
export function jsonWechatSuccess<T>(data: T, status = 200) {
  return jsonSuccess(imageUrlFormatter(data), status);
}

/** 小程序业务 API 统一错误响应（含业务错误码，不暴露堆栈） */
export function jsonWechatError(
  message: string,
  status = 400,
  code?: MiniprogramErrorCode
) {
  if (code) {
    return NextResponse.json(buildBusinessErrorBody(code, message), { status });
  }
  return NextResponse.json(
    {
      ok: false,
      success: false,
      error: message,
      message,
    },
    { status }
  );
}

/** @alias jsonWechatSuccess — 语义化命名，供 /api/miniprogram 路由使用 */
export const jsonMiniProgramSuccess = jsonWechatSuccess;
