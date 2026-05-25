import { prisma } from "@/lib/prisma";

/** 仅展示存在物理批次且剩余量 > 0 的原材料（配方 BOM 不会污染此列表） */
export const physicalStockMaterialWhere = {
  batches: {
    some: {
      remainingQty: { gt: 0 },
    },
  },
} as const;

export async function listPhysicalInventoryMaterials() {
  return prisma.material.findMany({
    where: physicalStockMaterialWhere,
    include: {
      batches: {
        where: { remainingQty: { gt: 0 } },
        orderBy: { inboundAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
}

/** 仪表盘低库存：仅统计曾入库（有批次记录）的原材料 */
export async function listMaterialsForLowStockCheck() {
  return prisma.material.findMany({
    where: {
      batches: { some: {} },
    },
    include: {
      batches: {
        where: { remainingQty: { gt: 0 } },
        select: { remainingQty: true },
      },
    },
    orderBy: { name: "asc" },
  });
}
