import { PRODUCT_STATUS_PUBLISHED } from "@/lib/product-status";

export type CartClientItem = {
  productId: string;
  quantity: number;
};

export type CartProductSnapshot = {
  id: string;
  name: string;
  sku: string;
  sellPrice: string;
  imageUrl: string | null;
  shippingFee: number;
  status: string;
  isDeleted: boolean;
  isOutOfStock: boolean;
  quantity: number;
};

export type CartLineResponse = {
  productId: string;
  quantity: number;
  isInvalid: boolean;
  invalidReason: string | null;
  product: CartProductSnapshot | null;
};

/** 商品是否应对购物车展示为失效（软删除或未上架） */
export function isCartProductInvalid(product: {
  isDeleted: boolean;
  status: string;
}): boolean {
  if (product.isDeleted) return true;
  return product.status !== PRODUCT_STATUS_PUBLISHED;
}

export function cartInvalidReason(product: {
  isDeleted: boolean;
  status: string;
}): string {
  if (product.isDeleted) return "已下架";
  if (product.status !== PRODUCT_STATUS_PUBLISHED) return "已下架";
  return "已失效";
}
