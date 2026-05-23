import { StockLogType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export type MaterialDetailView = {
  id: string;
  name: string;
  materialCode: string;
  unit: string;
  totalQty: number;
  safetyThreshold: number;
  batches: Array<{
    id: string;
    batchNo: string;
    inboundAt: string;
    originalQty: number;
    remainingQty: number;
    expiresAt: string;
    storageLocation: string;
  }>;
  fifoFlows: Array<{
    at: string;
    type: StockLogType;
    typeLabel: string;
    batchNo: string;
    qty: number;
    ref: string;
  }>;
};

const STOCK_LOG_LABEL: Record<StockLogType, string> = {
  INBOUND: "采购入库",
  SALE_OUT: "销售出库",
  WASTAGE_OUT: "损耗出库",
  ADJUSTMENT: "盘点调整",
  IN_CANCEL: "订单取消回库",
};

function formatDateTime(d: Date): string {
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stockLogRef(
  type: StockLogType,
  remark: string | null,
  wastageReason: string | null,
  orderNo: string | null | undefined
): string {
  if (type === StockLogType.SALE_OUT && orderNo) {
    return orderNo;
  }
  if (type === StockLogType.WASTAGE_OUT) {
    return wastageReason?.trim() || remark?.trim() || "损耗登记";
  }
  if (type === StockLogType.INBOUND) {
    return remark?.trim() || "采购入库";
  }
  if (type === StockLogType.ADJUSTMENT) {
    return remark?.trim() || "盘点调整";
  }
  if (type === StockLogType.IN_CANCEL) {
    return orderNo?.trim() || remark?.trim() || "订单取消";
  }
  return remark?.trim() || "库存变动";
}

/**
 * 原材料库存详情：历史批次 + 库存流水（FIFO 追踪基础数据）。
 * 复杂 FIFO 扣减演算见 services/fifo.ts，此处仅展示流水事实。
 */
export async function loadMaterialInventoryDetail(
  materialId: string
): Promise<MaterialDetailView | null> {
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    include: {
      batches: {
        orderBy: { inboundAt: "asc" },
      },
      stockLogs: {
        orderBy: { createdAt: "desc" },
        take: 80,
        include: {
          batch: { select: { batchNo: true } },
          order: { select: { orderNo: true } },
        },
      },
    },
  });

  if (!material) {
    return null;
  }

  const totalQty = material.batches.reduce((sum, b) => sum + b.remainingQty, 0);

  return {
    id: material.id,
    name: material.name,
    materialCode: material.materialCode,
    unit: material.unit,
    totalQty,
    safetyThreshold: material.safetyStockThreshold,
    batches: material.batches.map((b) => ({
      id: b.id,
      batchNo: b.batchNo ?? b.id.slice(0, 8),
      inboundAt: b.inboundAt.toISOString(),
      originalQty: b.originalQty,
      remainingQty: b.remainingQty,
      expiresAt: b.expiresAt
        ? b.expiresAt.toLocaleDateString("zh-CN")
        : "未设置",
      storageLocation: b.storageLocation?.trim() || "未分配库位",
    })),
    fifoFlows: material.stockLogs.map((log) => ({
      at: formatDateTime(log.createdAt),
      type: log.type,
      typeLabel: STOCK_LOG_LABEL[log.type] ?? log.type,
      batchNo: log.batch.batchNo ?? log.batchId.slice(0, 8),
      qty: log.quantity,
      ref: stockLogRef(
        log.type,
        log.remark,
        log.wastageReason,
        log.order?.orderNo
      ),
    })),
  };
}
