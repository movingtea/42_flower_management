import { formatCurrency } from "@/lib/format-money";
import { formatNullable, formatNumber } from "@/lib/format-display";
import type { PurchaseAnalyticsBatchCostRow } from "@/lib/purchase-analytics-types";
import { EmptyRow, TableShell, TagList } from "./report-ui";

export function BatchCostContributionTable({
  rows,
}: {
  rows: PurchaseAnalyticsBatchCostRow[];
}) {
  return (
    <TableShell>
      <thead className="border-b border-zinc-100 bg-zinc-50">
        <tr>
          <th className="px-4 py-3 font-medium text-zinc-600">批次号</th>
          <th className="px-4 py-3 font-medium text-zinc-600">花材</th>
          <th className="px-4 py-3 font-medium text-zinc-600">供应商</th>
          <th className="px-4 py-3 font-medium text-zinc-600">销售出库数量</th>
          <th className="px-4 py-3 font-medium text-zinc-600">关联订单数</th>
          <th className="px-4 py-3 font-medium text-zinc-600">原始成本贡献</th>
          <th className="px-4 py-3 font-medium text-zinc-600">损耗后成本贡献</th>
          <th className="px-4 py-3 font-medium text-zinc-600">损耗模型增加成本</th>
          <th className="px-4 py-3 font-medium text-zinc-600">平均原始单支成本</th>
          <th className="px-4 py-3 font-medium text-zinc-600">平均损耗后单支成本</th>
          <th className="px-4 py-3 font-medium text-zinc-600">标签</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 ? (
          <EmptyRow colSpan={11} text="暂无销售出库对应的批次成本贡献数据。" />
        ) : (
          rows.map((row) => (
            <tr key={row.batchId} className="hover:bg-zinc-50/50">
              <td className="px-4 py-3 font-medium text-zinc-900">
                {row.batchNo ?? row.batchId.slice(0, 8)}
              </td>
              <td className="px-4 py-3">{row.flowerName}</td>
              <td className="px-4 py-3">{row.supplierName ?? "—"}</td>
              <td className="px-4 py-3">{formatNumber(row.soldQty)}</td>
              <td className="px-4 py-3">{formatNumber(row.orderCount)}</td>
              <td className="px-4 py-3">{formatCurrency(row.rawCostContribution)}</td>
              <td className="px-4 py-3">{formatCurrency(row.lossAdjustedCostContribution)}</td>
              <td className="px-4 py-3 text-amber-700">
                {formatCurrency(row.lossModelExtraCost)}
              </td>
              <td className="px-4 py-3">
                {formatNullable(row.averageRawUnitCost, formatCurrency)}
              </td>
              <td className="px-4 py-3">
                {formatNullable(row.averageLossAdjustedUnitCost, formatCurrency)}
              </td>
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
