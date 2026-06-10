import { formatCurrency } from "@/lib/format-money";
import {
  formatDate,
  formatNullable,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/format-display";
import type { PurchaseAnalyticsFlowerTrendRow } from "@/lib/purchase-analytics-types";
import { EmptyRow, TableShell, TagList } from "./report-ui";

export function FlowerPriceTrendTable({
  rows,
}: {
  rows: PurchaseAnalyticsFlowerTrendRow[];
}) {
  return (
    <TableShell>
      <thead className="border-b border-zinc-100 bg-zinc-50">
        <tr>
          <th className="px-4 py-3 font-medium text-zinc-600">花材</th>
          <th className="px-4 py-3 font-medium text-zinc-600">最近供应商</th>
          <th className="px-4 py-3 font-medium text-zinc-600">最近采购日期</th>
          <th className="px-4 py-3 font-medium text-zinc-600">最近实际单支成本</th>
          <th className="px-4 py-3 font-medium text-zinc-600">上次实际单支成本</th>
          <th className="px-4 py-3 font-medium text-zinc-600">实际成本变化</th>
          <th className="px-4 py-3 font-medium text-zinc-600">实际成本变化率</th>
          <th className="px-4 py-3 font-medium text-zinc-600">最近损耗后单支成本</th>
          <th className="px-4 py-3 font-medium text-zinc-600">损耗后成本变化率</th>
          <th className="px-4 py-3 font-medium text-zinc-600">采购次数</th>
          <th className="px-4 py-3 font-medium text-zinc-600">标签</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 ? (
          <EmptyRow colSpan={11} text="当前时间范围内暂无花材采购价趋势数据。" />
        ) : (
          rows.map((row) => (
            <tr key={row.flowerWikiId} className="hover:bg-zinc-50/50">
              <td className="px-4 py-3 font-medium text-zinc-900">{row.flowerName}</td>
              <td className="px-4 py-3">{row.latestSupplierName ?? "—"}</td>
              <td className="px-4 py-3">{formatDate(row.latestPurchaseDate)}</td>
              <td className="px-4 py-3">
                {formatNullable(row.latestActualUnitCost, formatCurrency)}
              </td>
              <td className="px-4 py-3">
                {row.previousActualUnitCost
                  ? formatCurrency(row.previousActualUnitCost)
                  : "暂无上次采购"}
              </td>
              <td className="px-4 py-3">{formatSignedCurrency(row.actualUnitCostChange)}</td>
              <td className="px-4 py-3">{formatSignedPercent(row.actualUnitCostChangeRate)}</td>
              <td className="px-4 py-3">
                {formatNullable(row.latestLossAdjustedUnitCost, formatCurrency)}
              </td>
              <td className="px-4 py-3">
                {formatSignedPercent(row.lossAdjustedUnitCostChangeRate)}
              </td>
              <td className="px-4 py-3">{row.purchaseCount}</td>
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
