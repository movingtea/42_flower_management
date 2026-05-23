import { prisma } from "@/lib/prisma";
import { activeSpuWhere } from "@/lib/product-query";

/** 软删除商品 SPU：仅将 isDeleted 置为 true */
export async function softDeleteProduct(spuId: string) {
  const existing = await prisma.productSpu.findFirst({
    where: { id: spuId, ...activeSpuWhere },
    select: { id: true, name: true },
  });

  if (!existing) {
    throw new Error("商品不存在或已删除");
  }

  return prisma.productSpu.update({
    where: { id: spuId },
    data: { isDeleted: true },
    select: { id: true, name: true },
  });
}
