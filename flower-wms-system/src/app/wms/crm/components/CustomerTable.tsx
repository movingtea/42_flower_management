"use client";

import Link from "next/link";
import { EmptyRow, TableShell } from "@/app/wms/reports/components/report-ui";
import { CustomerSourceBadge } from "@/app/wms/crm/components/CrmTagBadge";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/format-money";
import { formatDateTime } from "@/lib/format-display";

export type CustomerListRow = {
  id: string;
  name: string;
  phone?: string | null;
  source: string;
  totalOrders: number;
  totalSpent: number;
  averageOrderValue: number;
  lastOrderAt?: string | Date | null;
  recipientCount?: number;
  pendingReminderCount?: number;
  tags?: string[];
};

type Props = {
  rows: CustomerListRow[];
  emptyText?: string;
};

export function CustomerTable({
  rows,
  emptyText = "暂无客户数据。小程序订单创建后会自动沉淀客户档案。",
}: Props) {
  return (
    <TableShell>
      <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
        <tr>
          <th className="px-4 py-3">客户姓名</th>
          <th className="px-4 py-3">手机号</th>
          <th className="px-4 py-3">来源</th>
          <th className="px-4 py-3">累计订单</th>
          <th className="px-4 py-3">累计消费</th>
          <th className="px-4 py-3">平均客单价</th>
          <th className="px-4 py-3">最近购买</th>
          <th className="px-4 py-3">收花人</th>
          <th className="px-4 py-3">待跟进</th>
          <th className="px-4 py-3">标签</th>
          <th className="px-4 py-3">操作</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 ? (
          <EmptyRow colSpan={11} text={emptyText} />
        ) : (
          rows.map((row) => (
            <tr key={row.id} className="text-zinc-700">
              <td className="px-4 py-3 font-medium text-zinc-900">{row.name}</td>
              <td className="px-4 py-3">{row.phone ?? "—"}</td>
              <td className="px-4 py-3">
                <CustomerSourceBadge source={row.source} />
              </td>
              <td className="px-4 py-3">{row.totalOrders}</td>
              <td className="px-4 py-3">{formatCurrency(row.totalSpent)}</td>
              <td className="px-4 py-3">
                {formatCurrency(row.averageOrderValue)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {formatDateTime(row.lastOrderAt)}
              </td>
              <td className="px-4 py-3">{row.recipientCount ?? 0}</td>
              <td className="px-4 py-3">{row.pendingReminderCount ?? 0}</td>
              <td className="px-4 py-3">
                {row.tags && row.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {row.tags.map((tag) => (
                      <Badge key={tag} variant="default">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/wms/crm/customers/${row.id}`}
                  className="text-emerald-700 hover:underline"
                >
                  查看详情
                </Link>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </TableShell>
  );
}
