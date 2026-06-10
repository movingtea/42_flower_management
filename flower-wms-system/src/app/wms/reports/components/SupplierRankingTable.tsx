import { supplierTypeLabels } from "@/app/wms/purchase-orders/types";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import { formatDate, formatNullable, formatNumber } from "@/lib/format-display";
import type { PurchaseAnalyticsSupplierRow } from "@/lib/purchase-analytics-types";
import { EmptyRow, TableShell, TagList } from "./report-ui";

function supplierTypeLabel(value: string): string {
  return supplierTypeLabels[value as keyof typeof supplierTypeLabels] ?? value;
}

export function SupplierRankingTable({
  rows,
}: {
  rows: PurchaseAnalyticsSupplierRow[];
}) {
  return (
    <TableShell>
      <thead className="border-b border-zinc-100 bg-zinc-50">
        <tr>
          <th className="px-4 py-3 font-medium text-zinc-600">供应商</th>
          <th className="px-4 py-3 font-medium text-zinc-600">类型</th>
          <th className="px-4 py-3 font-medium text-zinc-600">采购金额</th>
          <th className="px-4 py-3 font-medium text-zinc-600">采购单数</th>
          <th className="px-4 py-3 font-medium text-zinc-600">入库支数</th>
          <th className="px-4 py-3 font-medium text-zinc-600">平均实际单支成本</th>
          <th className="px-4 py-3 font-medium text-zinc-600">平均损耗后单支成本</th>
          <th className="px-4 py-3 font-medium text-zinc-600">损耗影响率</th>
          <th className="px-4 py-3 font-medium text-zinc-600">最近采购日期</th>
          <th className="px-4 py-3 font-medium text-zinc-600">标签</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 ? (
          <EmptyRow colSpan={10} text="当前时间范围内暂无供应商采购数据。" />
        ) : (
          rows.map((row) => (
            <tr key={row.supplierId} className="hover:bg-zinc-50/50">
              <td className="px-4 py-3 font-medium text-zinc-900">{row.supplierName}</td>
              <td className="px-4 py-3 text-zinc-600">{supplierTypeLabel(row.supplierType)}</td>
              <td className="px-4 py-3">{formatCurrency(row.purchaseAmount)}</td>
              <td className="px-4 py-3">{row.purchaseOrderCount}</td>
              <td className="px-4 py-3">{formatNumber(row.inboundStems)}</td>
              <td className="px-4 py-3">
                {formatNullable(row.averageActualUnitCost, formatCurrency)}
              </td>
              <td className="px-4 py-3">
                {formatNullable(row.averageLossAdjustedUnitCost, formatCurrency)}
              </td>
              <td className="px-4 py-3">
                {row.lossImpactRate === null ? "—" : formatPercent(row.lossImpactRate)}
              </td>
              <td className="px-4 py-3">{formatDate(row.latestPurchaseDate)}</td>
              <td className="px-4 py-3">
                <TagList tags={row.tags} />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </TableShell>
  );
}
