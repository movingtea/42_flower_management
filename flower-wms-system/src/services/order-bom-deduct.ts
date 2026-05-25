import { OrderStatus, StockLogType } from "@/generated/prisma/enums";
import { applyFifoDeductions } from "@/services/fifo";
import { prisma } from "@/lib/prisma";

/** 订单进入制作中：按 ProductBOM × 订单数量 FIFO 扣减原材料 */
export async function deductMaterialsForOrderProduction(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          sku: { select: { spuId: true } },
        },
      },
    },
  });

  if (!order || order.status !== OrderStatus.PRODUCTION) {
    return { skipped: true, reason: "订单非制作中状态" };
  }

  const existing = await prisma.stockLog.count({
    where: { orderId, type: StockLogType.SALE_OUT },
  });
  if (existing > 0) {
    return { skipped: true, reason: "已扣减过库存" };
  }

  const deductions: Awaited<ReturnType<typeof applyFifoDeductions>>[] = [];

  for (const item of order.items) {
    const spuId = item.sku?.spuId;
    if (!spuId) continue;

    const bomLines = await prisma.productBOM.findMany({
      where: { spuId },
    });

    for (const bom of bomLines) {
      const qty = bom.quantityNeeded * item.quantity;
      if (qty <= 0) continue;
      const result = await applyFifoDeductions({
        materialId: bom.materialId,
        quantity: qty,
        logType: StockLogType.SALE_OUT,
        orderId: order.id,
        orderItemId: item.id,
        operator: "kanban-auto",
      });
      deductions.push(result);
    }
  }

  return { skipped: false, deductions };
}

/** 异步触发（不阻塞看板 UI） */
export function triggerOrderProductionDeduction(orderId: string) {
  void deductMaterialsForOrderProduction(orderId).catch((err) => {
    console.error("[order-bom-deduct]", orderId, err);
  });
}
