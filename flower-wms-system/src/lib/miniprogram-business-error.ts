export const MINIPROGRAM_ERROR_CODES = {
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  PRODUCT_OFF_SHELF: "PRODUCT_OFF_SHELF",
  SKU_INACTIVE: "SKU_INACTIVE",
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  SKU_NOT_FOUND: "SKU_NOT_FOUND",
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
