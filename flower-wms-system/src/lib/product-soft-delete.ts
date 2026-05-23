import { prisma } from "@/lib/prisma";
import { activeProductWhere } from "@/lib/product-query";

/** 软删除商品：仅将 isDeleted 置为 true，保留订单等历史关联 */
export async function softDeleteProduct(productId: string) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, ...activeProductWhere },
    select: { id: true, name: true },
  });

  if (!existing) {
    throw new Error("商品不存在或已删除");
  }

  return prisma.product.update({
    where: { id: productId },
    data: { isDeleted: true },
    select: { id: true, sku: true, name: true },
  });
}
