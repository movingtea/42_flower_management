import { StockLogType } from "@/generated/prisma/enums";
import {
  formatDateInAppTimezoneIso,
  formatDateTimeInAppTimezone,
} from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { listStockLossHistoryByMaterialId } from "@/services/wms-stock";

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
  lossHistory: Array<{
    id: string;
    at: string;
    batchLabel: string;
    lossQuantity: number;
    reason: string;
  }>;
};

const STOCK_LOG_LABEL: Record<StockLogType, string> = {
  INBOUND: "采购入库",
  SALE_OUT: "销售出库",
  WASTAGE_OUT: "损耗出库",
  ADJUSTMENT: "盘点调整",
  IN_CANCEL: "订单取消回库",
};

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
  const lossRows = await listStockLossHistoryByMaterialId(materialId);

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
        ? formatDateInAppTimezoneIso(b.expiresAt)
        : "未设置",
      storageLocation: b.storageLocation?.trim() || "未分配库位",
    })),
    fifoFlows: material.stockLogs.map((log) => ({
      at: formatDateTimeInAppTimezone(log.createdAt),
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
    lossHistory: lossRows.map((row) => ({
      id: row.id,
      at: formatDateTimeInAppTimezone(row.createdAt),
      batchLabel: row.batchNo
        ? `${row.batchNo}（${formatDateInAppTimezoneIso(row.batchCreatedAt)}）`
        : formatDateInAppTimezoneIso(row.batchCreatedAt),
      lossQuantity: row.lossQuantity,
      reason: row.reason,
    })),
  };
}
