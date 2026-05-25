import { prisma } from "@/lib/prisma";

export async function loadOrderBomHints(orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, BomHintLine[]>();

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: {
      items: {
        include: {
          sku: { select: { spuId: true } },
        },
      },
    },
  });

  const spuIds = [
    ...new Set(
      orders.flatMap((o) =>
        o.items.map((i) => i.sku?.spuId).filter((id): id is string => Boolean(id))
      )
    ),
  ];

  const bomBySpu = new Map<string, BomHintLine[]>();
  if (spuIds.length > 0) {
    const bomRows = await prisma.productBOM.findMany({
      where: { spuId: { in: spuIds } },
      include: {
        material: { include: { wiki: true } },
      },
    });
    for (const row of bomRows) {
      const list = bomBySpu.get(row.spuId) ?? [];
      list.push({
        englishName: row.material.wiki?.englishName ?? row.material.name,
        chineseName: row.material.wiki?.chineseName ?? row.material.name,
        quantityNeeded: row.quantityNeeded,
        maintenance: row.material.wiki?.maintenance ?? null,
      });
      bomBySpu.set(row.spuId, list);
    }
  }

  const result = new Map<string, BomHintLine[]>();
  for (const order of orders) {
    const merged: BomHintLine[] = [];
    for (const item of order.items) {
      const spuId = item.sku?.spuId;
      if (!spuId) continue;
      const lines = bomBySpu.get(spuId) ?? [];
      for (const line of lines) {
        merged.push({
          ...line,
          quantityNeeded: line.quantityNeeded * item.quantity,
        });
      }
    }
    result.set(order.id, merged);
  }
  return result;
}

export type BomHintLine = {
  englishName: string;
  chineseName: string;
  quantityNeeded: number;
  maintenance: string | null;
};
