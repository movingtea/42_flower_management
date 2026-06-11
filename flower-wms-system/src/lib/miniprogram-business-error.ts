export const MINIPROGRAM_ERROR_CODES = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  PRODUCT_OFF_SHELF: "PRODUCT_OFF_SHELF",
  SKU_NOT_FOUND: "SKU_NOT_FOUND",
  SKU_INACTIVE: "SKU_INACTIVE",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  PRICE_CHANGED: "PRICE_CHANGED",
  INVALID_DELIVERY_DATE: "INVALID_DELIVERY_DATE",
  BULK_ORDER_REQUIRES_PREORDER: "BULK_ORDER_REQUIRES_PREORDER",
  DELIVERY_SLOT_UNAVAILABLE: "DELIVERY_SLOT_UNAVAILABLE",
  CART_ITEM_UNAVAILABLE: "CART_ITEM_UNAVAILABLE",
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  ORDER_INVALID_STATE: "ORDER_INVALID_STATE",
  ORDER_EXPIRED: "ORDER_EXPIRED",
} as const;

export type MiniprogramErrorCode =
  (typeof MINIPROGRAM_ERROR_CODES)[keyof typeof MINIPROGRAM_ERROR_CODES];

export class MiniprogramBusinessError extends Error {
  readonly code: MiniprogramErrorCode;

  constructor(code: MiniprogramErrorCode, message: string) {
    super(message);
    this.name = "MiniprogramBusinessError";
    this.code = code;
  }
}

export function isMiniprogramBusinessError(
  err: unknown
): err is MiniprogramBusinessError {
  return err instanceof MiniprogramBusinessError;
}
