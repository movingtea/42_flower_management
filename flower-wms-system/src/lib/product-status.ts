/** 前台成品商品状态 */
export const PRODUCT_STATUS_DRAFT = "DRAFT" as const;
export const PRODUCT_STATUS_PUBLISHED = "PUBLISHED" as const;
export const PRODUCT_STATUS_ARCHIVED = "ARCHIVED" as const;

export type ProductStatus =
  | typeof PRODUCT_STATUS_DRAFT
  | typeof PRODUCT_STATUS_PUBLISHED
  | typeof PRODUCT_STATUS_ARCHIVED;

export function productStatusFromIsActive(isActive: boolean): ProductStatus {
  return isActive ? PRODUCT_STATUS_PUBLISHED : PRODUCT_STATUS_ARCHIVED;
}
