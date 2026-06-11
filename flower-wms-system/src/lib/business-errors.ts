/**
 * 统一业务错误码（小程序 + 后台）。
 * 路由层应通过本模块常量与 helper 返回，避免散落 magic string。
 */
import { NextResponse } from "next/server";

export {
  MINIPROGRAM_ERROR_CODES,
  MiniprogramBusinessError,
  isMiniprogramBusinessError,
  type MiniprogramErrorCode,
} from "@/lib/miniprogram-business-error";

import type { MiniprogramErrorCode } from "@/lib/miniprogram-business-error";

/** 后台管理 API 业务错误码 */
export const ADMIN_ERROR_CODES = {
  PERMISSION_DENIED: "PERMISSION_DENIED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  ENTITY_NOT_FOUND: "ENTITY_NOT_FOUND",
  DUPLICATE_KEY: "DUPLICATE_KEY",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  BUSINESS_RULE_VIOLATION: "BUSINESS_RULE_VIOLATION",
} as const;

export type AdminErrorCode =
  (typeof ADMIN_ERROR_CODES)[keyof typeof ADMIN_ERROR_CODES];

export type BusinessErrorCode = MiniprogramErrorCode | AdminErrorCode;

/** 小程序默认文案（可被服务端 message 覆盖） */
export const MINIPROGRAM_ERROR_MESSAGES: Record<MiniprogramErrorCode, string> = {
  AUTH_REQUIRED: "请先登录",
  PRODUCT_NOT_FOUND: "商品不存在",
  PRODUCT_OFF_SHELF: "商品已下架",
  SKU_NOT_FOUND: "规格不存在",
  SKU_INACTIVE: "该规格暂不可售",
  INSUFFICIENT_STOCK: "库存不足",
  INVALID_QUANTITY: "购买数量不正确",
  PRICE_CHANGED: "商品价格有变化，请重新确认",
  INVALID_DELIVERY_DATE: "请选择有效配送日期",
  BULK_ORDER_REQUIRES_PREORDER:
    "这份花礼数量较多，我们需要提前为你备花和制作，暂不支持当天送达",
  DELIVERY_SLOT_UNAVAILABLE: "该配送时段暂不可选",
  CART_ITEM_UNAVAILABLE: "部分商品暂不可结算，请重新确认",
  ORDER_NOT_FOUND: "订单不存在",
  ORDER_INVALID_STATE: "当前订单状态无法操作",
  ORDER_EXPIRED: "订单已超时关闭，请重新下单",
};

/** 后台默认文案 */
export const ADMIN_ERROR_MESSAGES: Record<AdminErrorCode, string> = {
  PERMISSION_DENIED: "你没有权限执行此操作",
  VALIDATION_ERROR: "请检查填写内容",
  ENTITY_NOT_FOUND: "数据不存在或已被删除",
  DUPLICATE_KEY: "该 key 已被使用",
  INVALID_STATE_TRANSITION: "当前状态不允许此操作",
  BUSINESS_RULE_VIOLATION: "操作不符合业务规则",
};

export function formatInsufficientStockMessage(available: number): string {
  if (available <= 0) {
    return "库存不足";
  }
  return `库存不足，当前仅剩 ${available} 件`;
}

export type BusinessErrorBody = {
  ok: false;
  success: false;
  code: BusinessErrorCode;
  message: string;
  error: string;
  details?: Record<string, unknown>;
};

export function buildBusinessErrorBody(
  code: BusinessErrorCode,
  message: string,
  details?: Record<string, unknown>
): BusinessErrorBody {
  return {
    ok: false,
    success: false,
    code,
    message,
    error: message,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
  };
}

/** 小程序业务错误 JSON 响应 */
export function jsonMiniprogramBusinessError(
  code: MiniprogramErrorCode,
  message?: string,
  status = 400,
  details?: Record<string, unknown>
) {
  const msg = message ?? MINIPROGRAM_ERROR_MESSAGES[code];
  return NextResponse.json(buildBusinessErrorBody(code, msg, details), {
    status,
  });
}

/** 后台业务错误 JSON 响应 */
export function jsonAdminBusinessError(
  code: AdminErrorCode,
  message?: string,
  status = 400,
  details?: Record<string, unknown>
) {
  const msg = message ?? ADMIN_ERROR_MESSAGES[code];
  return NextResponse.json(buildBusinessErrorBody(code, msg, details), {
    status,
  });
}

export function permissionDeniedResponse(message?: string) {
  return jsonAdminBusinessError(
    ADMIN_ERROR_CODES.PERMISSION_DENIED,
    message ?? ADMIN_ERROR_MESSAGES.PERMISSION_DENIED,
    403
  );
}
