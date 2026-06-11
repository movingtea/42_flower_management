import type { MiniprogramErrorCode } from "@/lib/miniprogram-business-error";

export type CartClientItem = {
  productId: string;
  skuId?: string;
  quantity: number;
};

export type CartProductSnapshot = {
  spuId: string;
  skuId: string | null;
  name: string;
  specName: string | null;
  skuCode: string | null;
  sellPrice: string;
  imageUrl: string | null;
  shippingFee: number;
  isDeleted: boolean;
  isActive: boolean;
  isOutOfStock: boolean;
  stock: number;
};

export type CartInvalidCode =
  | MiniprogramErrorCode
  | "SELECT_SPEC"
  | null;

export type CartLineResponse = {
  productId: string;
  skuId: string | null;
  quantity: number;
  isInvalid: boolean;
  invalidReason: string | null;
  invalidCode: CartInvalidCode;
  product: CartProductSnapshot | null;
};

export function isCartSpuInvalid(spu: {
  isDeleted: boolean;
  isActive: boolean;
}): boolean {
  if (spu.isDeleted) return true;
  return !spu.isActive;
}

export function cartInvalidReason(spu: {
  isDeleted: boolean;
  isActive: boolean;
}): string {
  if (spu.isDeleted) return "已下架";
  if (!spu.isActive) return "已下架";
  return "已失效";
}
