import { StatCard } from "@/components/wms/stat-card";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import { formatNullable, formatNumber } from "@/lib/format-display";
import type { PurchaseAnalyticsSummaryDto } from "@/lib/purchase-analytics-types";

export function PurchaseAnalyticsSummaryCards({
  summary,
}: {
  summary: PurchaseAnalyticsSummaryDto;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="采购总金额"
          value={formatCurrency(summary.purchaseAmount)}
          hint={`已入库采购单 ${summary.receivedPurchaseOrderCount} 张`}
        />
        <StatCard
          label="活跃供应商"
          value={summary.supplierCount}
          hint={`采购单 ${summary.purchaseOrderCount} 张`}
        />
        <StatCard
          label="入库总支数"
          value={formatNumber(summary.totalInboundStems)}
          hint={`到货批次 ${summary.batchCount} 个`}
        />
        <StatCard
          label="平均采购单金额"
          value={formatCurrency(summary.averagePurchaseOrderAmount)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="原始采购成本"
          value={formatCurrency(summary.rawPurchaseCost)}
          hint={`平均实际单支 ${formatNullable(summary.averageActualUnitCost, formatCurrency)}`}
        />
        <StatCard
          label="损耗后采购成本"
          value={formatCurrency(summary.lossAdjustedPurchaseCost)}
          hint={`平均损耗后单支 ${formatNullable(summary.averageLossAdjustedUnitCost, formatCurrency)}`}
        />
        <StatCard
          label="损耗模型增加成本"
          value={formatCurrency(summary.lossModelExtraCost)}
          hint={
            summary.rawPurchaseCost !== "0.00"
              ? `占原始成本 ${formatPercent(
                  Number(summary.lossModelExtraCost) / Number(summary.rawPurchaseCost)
                )}`
              : "基于 Sprint 5 可用率模型估算"
          }
          variant="warning"
        />
        <StatCard
          label="平均损耗后单支成本"
          value={formatNullable(summary.averageLossAdjustedUnitCost, formatCurrency)}
          hint="用于经营估算，不等同于真实报损"
        />
      </div>
    </div>
  );
}
