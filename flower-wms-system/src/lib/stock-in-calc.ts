/** 纯计算：供客户端预览与服务端入库共用，勿引入 prisma / pg */

/** 束 → 支：计算入库总支数与单支成本（库存/FIFO 仍以支为基准单位） */
export function resolveStockInQuantities(payload: {
  bundleCount: number;
  stemsPerBundle: number;
  costPricePerBundle: number;
}) {
  const totalStems = payload.bundleCount * payload.stemsPerBundle;
  const unitCostPerStem = payload.costPricePerBundle / payload.stemsPerBundle;
  return { totalStems, unitCostPerStem };
}

/** 按入库时间与保质期（天）计算批次到期日 */
export function resolveBatchExpiresAt(
  inboundAt: Date,
  shelfLifeDays: number | null | undefined
): Date | null {
  if (shelfLifeDays == null || shelfLifeDays <= 0) return null;
  return new Date(inboundAt.getTime() + shelfLifeDays * 24 * 60 * 60 * 1000);
}
