"use client";

import { Fragment, useState } from "react";
import { JsonPreview } from "@/components/admin/JsonPreview";
import { getAuditModuleLabel } from "@/lib/audit-labels";
import { formatDateTime } from "@/lib/format-display";

export type AuditLogRow = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  module: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

type Props = {
  logs: AuditLogRow[];
  emptyText?: string;
};

export function AuditLogTable({
  logs,
  emptyText = "暂无操作日志。后续关键采购、库存、CMS、CRM 操作会记录在这里。",
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 shadow-sm">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-4 py-3">时间</th>
            <th className="px-4 py-3">操作人</th>
            <th className="px-4 py-3">模块</th>
            <th className="px-4 py-3">操作</th>
            <th className="px-4 py-3">对象</th>
            <th className="px-4 py-3">摘要</th>
            <th className="px-4 py-3">详情</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {logs.map((log) => {
            const open = expandedId === log.id;
            return (
              <Fragment key={log.id}>
                <tr className="text-zinc-700">
                  <td className="whitespace-nowrap px-4 py-3">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td className="px-4 py-3">{log.actorName ?? "—"}</td>
                  <td className="px-4 py-3">{getAuditModuleLabel(log.module)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
                  <td className="px-4 py-3">
                    <div>{log.entityType}</div>
                    <div className="text-xs text-zinc-400">{log.entityId ?? "—"}</div>
                  </td>
                  <td className="max-w-xs px-4 py-3">{log.summary}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-emerald-700 hover:underline"
                      onClick={() =>
                        setExpandedId(open ? null : log.id)
                      }
                    >
                      {open ? "收起" : "查看"}
                    </button>
                  </td>
                </tr>
                {open ? (
                  <tr>
                    <td colSpan={7} className="bg-zinc-50 px-4 py-4">
                      <div className="grid gap-4 lg:grid-cols-3">
                        <JsonPreview
                          label="变更前"
                          value={log.beforeSnapshot}
                        />
                        <JsonPreview
                          label="变更后"
                          value={log.afterSnapshot}
                        />
                        <JsonPreview label="元数据" value={log.metadata} />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
