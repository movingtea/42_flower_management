"use client";

import Link from "next/link";
import { EmptyRow } from "@/app/wms/reports/components/report-ui";
import { CustomerSourceBadge } from "@/app/wms/crm/components/CrmTagBadge";
import { Badge } from "@/components/ui/Badge";
import {
  STICKY_ACTIONS,
  STICKY_LEFT_CELL,
  STICKY_LEFT_HEAD,
  STICKY_RIGHT_CELL,
  STICKY_RIGHT_HEAD,
  STICKY_SCROLL_CELL,
  STICKY_SCROLL_HEAD,
  STICKY_TABLE_ROW,
  StickyTableScroll,
} from "@/components/admin/sticky-table";
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
  onViewDetail?: (customerId: string) => void;
};

export function CustomerTable({
  rows,
  emptyText = "暂无客户数据。小程序订单创建后会自动沉淀客户档案。",
  onViewDetail,
}: Props) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-100 bg-white">
      <StickyTableScroll minWidth="1100px">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className={STICKY_LEFT_HEAD}>客户姓名</th>
            <th className={STICKY_SCROLL_HEAD}>手机号</th>
            <th className={STICKY_SCROLL_HEAD}>来源</th>
            <th className={STICKY_SCROLL_HEAD}>累计订单</th>
            <th className={STICKY_SCROLL_HEAD}>累计消费</th>
            <th className={STICKY_SCROLL_HEAD}>平均客单价</th>
            <th className={STICKY_SCROLL_HEAD}>最近购买</th>
            <th className={STICKY_SCROLL_HEAD}>收花人</th>
            <th className={STICKY_SCROLL_HEAD}>待跟进</th>
            <th className={STICKY_SCROLL_HEAD}>标签</th>
            <th className={STICKY_RIGHT_HEAD}>操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.length === 0 ? (
            <EmptyRow colSpan={11} text={emptyText} />
          ) : (
            rows.map((row) => (
              <tr key={row.id} className={STICKY_TABLE_ROW}>
                <td className={STICKY_LEFT_CELL}>{row.name}</td>
                <td className={STICKY_SCROLL_CELL}>{row.phone ?? "—"}</td>
                <td className={STICKY_SCROLL_CELL}>
                  <CustomerSourceBadge source={row.source} />
                </td>
                <td className={STICKY_SCROLL_CELL}>{row.totalOrders}</td>
                <td className={STICKY_SCROLL_CELL}>
                  {formatCurrency(row.totalSpent)}
                </td>
                <td className={STICKY_SCROLL_CELL}>
                  {formatCurrency(row.averageOrderValue)}
                </td>
                <td className={`whitespace-nowrap ${STICKY_SCROLL_CELL}`}>
                  {formatDateTime(row.lastOrderAt)}
                </td>
                <td className={STICKY_SCROLL_CELL}>
                  {row.recipientCount ?? 0}
                </td>
                <td className={STICKY_SCROLL_CELL}>
                  {row.pendingReminderCount ?? 0}
                </td>
                <td className={STICKY_SCROLL_CELL}>
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
                <td className={STICKY_RIGHT_CELL}>
                  <div className={STICKY_ACTIONS}>
                    {onViewDetail ? (
                      <button
                        type="button"
                        onClick={() => onViewDetail(row.id)}
                        className="text-emerald-700 hover:underline"
                      >
                        查看详情
                      </button>
                    ) : (
                      <Link
                        href={`/wms/crm/customers/${row.id}`}
                        className="text-emerald-700 hover:underline"
                      >
                        查看详情
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </StickyTableScroll>
    </div>
  );
}
