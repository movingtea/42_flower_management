"use client";

import Link from "next/link";
import { EmptyRow, TableShell } from "@/app/wms/reports/components/report-ui";
import {
  ReminderStatusBadge,
  ReminderTypeBadge,
} from "@/app/wms/crm/components/CrmTagBadge";
import { ReminderActionButtons } from "@/app/wms/crm/components/ReminderActionButtons";
import { formatNullable } from "@/lib/format-display";

export type ReminderRow = {
  id: string;
  title: string;
  content?: string | null;
  customerId: string;
  customerName?: string | null;
  recipientName?: string | null;
  type: string;
  status: string;
  remindAtLabel?: string | null;
  dueDateLabel?: string | null;
  orderId?: string | null;
};

type Props = {
  rows: ReminderRow[];
  emptyText?: string;
  showActions?: boolean;
  onUpdated?: () => void;
};

export function ReminderTable({
  rows,
  emptyText = "当前时间范围内暂无待跟进提醒。",
  showActions = true,
  onUpdated,
}: Props) {
  return (
    <TableShell>
      <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
        <tr>
          <th className="px-4 py-3">提醒时间</th>
          <th className="px-4 py-3">目标日期</th>
          <th className="px-4 py-3">客户</th>
          <th className="px-4 py-3">收花人</th>
          <th className="px-4 py-3">类型</th>
          <th className="px-4 py-3">标题</th>
          <th className="px-4 py-3">状态</th>
          {showActions && <th className="px-4 py-3">操作</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 ? (
          <EmptyRow colSpan={showActions ? 8 : 7} text={emptyText} />
        ) : (
          rows.map((row) => (
            <tr key={row.id} className="text-zinc-700">
              <td className="px-4 py-3 whitespace-nowrap">
                {formatNullable(row.remindAtLabel, (v) => v)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {formatNullable(row.dueDateLabel, (v) => v)}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/wms/crm/customers/${row.customerId}`}
                  className="text-emerald-700 hover:underline"
                >
                  {row.customerName ?? "—"}
                </Link>
              </td>
              <td className="px-4 py-3">{row.recipientName ?? "—"}</td>
              <td className="px-4 py-3">
                <ReminderTypeBadge type={row.type} />
              </td>
              <td className="px-4 py-3 max-w-xs">
                <div className="font-medium text-zinc-900">{row.title}</div>
                {row.content && (
                  <div className="mt-1 text-xs text-zinc-500 line-clamp-2">
                    {row.content}
                  </div>
                )}
              </td>
              <td className="px-4 py-3">
                <ReminderStatusBadge status={row.status} />
              </td>
              {showActions && (
                <td className="px-4 py-3">
                  {row.status === "PENDING" ? (
                    <ReminderActionButtons
                      reminderId={row.id}
                      onUpdated={onUpdated}
                    />
                  ) : (
                    "—"
                  )}
                </td>
              )}
            </tr>
          ))
        )}
      </tbody>
    </TableShell>
  );
}
