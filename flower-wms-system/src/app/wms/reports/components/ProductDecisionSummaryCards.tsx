import { StatCard } from "@/components/wms/stat-card";
import { formatNullable, formatNumber } from "@/lib/format-display";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import type { ProductDecisionSummary } from "@/lib/product-decision-types";

export function ProductDecisionSummaryCards({
  summary,
}: {
  summary: ProductDecisionSummary;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="产品数" value={formatNumber(summary.productCount)} />
        <StatCard label="SKU 数" value={formatNumber(summary.skuCount)} />
        <StatCard
          label="推荐主推"
          value={formatNumber(summary.recommendedCount)}
          variant="success"
        />
        <StatCard
          label="观察中"
          value={formatNumber(summary.observeCount)}
          hint={`活跃 SKU ${formatNumber(summary.activeSkuCount)}`}
        />
        <StatCard
          label="风险产品"
          value={formatNumber(summary.riskyCount)}
          variant="danger"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="低毛利产品"
          value={formatNumber(summary.lowMarginCount)}
          variant="warning"
        />
        <StatCard
          label="数据不完整"
          value={formatNumber(summary.incompleteDataCount)}
          variant="warning"
        />
        <StatCard
          label="总销售额"
          value={formatCurrency(summary.totalSalesAmount)}
          hint={`总订单 ${formatNumber(summary.totalOrderCount)} 笔`}
        />
        <StatCard
          label="平均标准毛利率"
          value={formatNullable(summary.averageStandardGrossMargin, (value) =>
            formatPercent(value)
          )}
        />
        <StatCard
          label="平均保守毛利率"
          value={formatNullable(summary.averageConservativeGrossMargin, (value) =>
            formatPercent(value)
          )}
        />
      </div>
    </div>
  );
}
