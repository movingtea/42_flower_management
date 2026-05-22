/**
 * @deprecated 商品/原材料已拆表，请使用 Product（成品）与 Material（原材料）。
 * 保留常量仅为兼容旧脚本引用。
 */
export const PRODUCT_TYPE_RAW = "RAW" as const;
export const PRODUCT_TYPE_PRODUCT = "PRODUCT" as const;

export type ProductType =
  | typeof PRODUCT_TYPE_RAW
  | typeof PRODUCT_TYPE_PRODUCT;
