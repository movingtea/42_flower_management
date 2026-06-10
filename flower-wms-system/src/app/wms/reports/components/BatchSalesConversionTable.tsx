import { formatPercent } from "@/lib/format-money";
import { formatDate, formatNumber } from "@/lib/format-display";
import type { PurchaseAnalyticsBatchConversionRow } from "@/lib/purchase-analytics-types";
import { EmptyRow, TableShell, TagList } from "./report-ui";

export function BatchSalesConversionTable({
  rows,
}: {
  rows: PurchaseAnalyticsBatchConversionRow[];
}) {
  const hasAnySales = rows.some((row) => row.soldQty > 0);

  return (
    <>
      {!hasAnySales && rows.length > 0 && (
        <p className="mb-3 text-xs text-zinc-500">
          暂无销售出库数据，完成订单支付后可查看批次转化。
        </p>
      )}
      <TableShell>
        <thead className="border-b border-zinc-100 bg-zinc-50">
          <tr>
            <th className="px-4 py-3 font-medium text-zinc-600">批次号</th>
            <th className="px-4 py-3 font-medium text-zinc-600">花材</th>
            <th className="px-4 py-3 font-medium text-zinc-600">供应商</th>
            <th className="px-4 py-3 font-medium text-zinc-600">入库日期</th>
            <th className="px-4 py-3 font-medium text-zinc-600">入库数量</th>
            <th className="px-4 py-3 font-medium text-zinc-600">已销售</th>
            <th className="px-4 py-3 font-medium text-zinc-600">已报损</th>
            <th className="px-4 py-3 font-medium text-zinc-600">取消回库</th>
            <th className="px-4 py-3 font-medium text-zinc-600">当前剩余</th>
            <th className="px-4 py-3 font-medium text-zinc-600">销售转化率</th>
            <th className="px-4 py-3 font-medium text-zinc-600">实际报损率</th>
            <th className="px-4 py-3 font-medium text-zinc-600">剩余率</th>
            <th className="px-4 py-3 font-medium text-zinc-600">标签</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.length === 0 ? (
            <EmptyRow colSpan={13} text="当前时间范围内暂无批次销售转化数据。" />
          ) : (
            rows.map((row) => (
              <tr key={row.batchId} className="hover:bg-zinc-50/50">
                <td className="px-4 py-3 font-medium text-zinc-900">
                  {row.batchNo ?? row.batchId.slice(0, 8)}
                </td>
                <td className="px-4 py-3">{row.flowerName}</td>
                <td className="px-4 py-3">{row.supplierName ?? "—"}</td>
                <td className="px-4 py-3">{formatDate(row.inboundDate)}</td>
                <td className="px-4 py-3">{formatNumber(row.originalQty)}</td>
                <td className="px-4 py-3">{formatNumber(row.soldQty)}</td>
                <td className="px-4 py-3">{formatNumber(row.wastageQty)}</td>
                <td className="px-4 py-3">{formatNumber(row.cancelReturnQty)}</td>
                <td className="px-4 py-3">{formatNumber(row.remainingQty)}</td>
                <td className="px-4 py-3">
                  {row.salesConversionRate === null
                    ? "—"
                    : formatPercent(row.salesConversionRate)}
                </td>
                <td className="px-4 py-3">
                  {row.actualWastageRate === null
                    ? "—"
                    : formatPercent(row.actualWastageRate)}
                </td>
                <td className="px-4 py-3">
                  {row.remainingRate === null ? "—" : formatPercent(row.remainingRate)}
                </td>
                <td className="px-4 py-3">
                  <TagList tags={row.tags} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </TableShell>
    </>
  );
}
