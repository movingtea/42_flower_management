import type { Prisma } from "@/generated/prisma/client";
import type { CmsProductBody } from "@/lib/cms-products";
import { cmsBodyToProductData } from "@/lib/cms-product-mapper";

/** 创建商品时的完整写入数据（含服务端生成的 sku） */
export function cmsProductCreateData(
  body: CmsProductBody,
  sku: string
): Prisma.ProductUncheckedCreateInput {
  return {
    ...cmsBodyToProductData(body),
    sku,
  };
}

/** 更新商品：不修改 sku */
export function cmsProductUpdateData(
  body: CmsProductBody
): Prisma.ProductUncheckedUpdateInput {
  return cmsBodyToProductData(body);
}
