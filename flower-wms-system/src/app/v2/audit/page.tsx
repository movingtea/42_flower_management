import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { formatDateTimeInAppTimezone } from "@/lib/datetime";
import { listAuditActions, listV2AuditEvents } from "@/v2/services/audit-query";
import { StatusBadge, V2ModulePage, button, card, input, tableHead, tableShell } from "../_components/V2Ui";
import { buildAuditHref, parseAuditFilters, type AuditSearchParams } from "./audit-params";

export const dynamic = "force-dynamic";

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text = (() => {
    if (value === null || value === undefined) return "—";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  })();
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-stone-500">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-xs leading-5 text-stone-700">
        {text}
      </pre>
    </div>
  );
}

const CHANGE_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  ADDED: "success",
  REMOVED: "warning",
  CHANGED: "info",
};

export default async function V2AuditPage({ searchParams }: { searchParams: Promise<AuditSearchParams> }) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/audit");
  }
  const scope = await requireV2Store("staff");
  const params = await searchParams;
  const filters = parseAuditFilters(params);
  const [result, actions] = await Promise.all([
    listV2AuditEvents(v2db, scope, filters),
    listAuditActions(v2db, scope),
  ]);

  return (
    <V2ModulePage
      title="操作日志"
      description="查询 V2 关键业务操作的 AuditEvent，支持操作、对象、操作人、日期筛选和分页；变更摘要来自变更前后快照。"
      actions={
        <>
          <Link href="/v2/system-health" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white">
            系统健康
          </Link>
          <Link href="/v2/setup" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white">
            试运营检查
          </Link>
        </>
      }
    >
      <div className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">审计查询</h2>
            <p className="mt-1 text-sm text-stone-500">
              当前门店及租户级事件共 {result.pagination.total} 条，按发生时间倒序。页面只读，不写入新审计事件。
            </p>
          </div>
          <p className="text-xs text-stone-400">第 {result.pagination.page} / {result.pagination.totalPages || 1} 页</p>
        </div>
        <form method="get" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-medium text-stone-600">
            操作
            <input className={`${input} mt-1`} name="action" defaultValue={filters.action ?? ""} list="audit-actions" placeholder="如 DELIVERY_COMPLETED" />
            <datalist id="audit-actions">
              {actions.map((action) => <option key={action} value={action} />)}
            </datalist>
          </label>
          <label className="text-xs font-medium text-stone-600">
            对象类型
            <input className={`${input} mt-1`} name="entityType" defaultValue={filters.entityType ?? ""} placeholder="如 Order" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            对象 ID
            <input className={`${input} mt-1`} name="entityId" defaultValue={filters.entityId ?? ""} placeholder="支持部分匹配" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            操作人 ID
            <input className={`${input} mt-1`} name="actor" defaultValue={filters.actorStaffId ?? ""} placeholder="StaffUser.id" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            开始日期
            <input className={`${input} mt-1`} type="date" name="startDate" defaultValue={filters.startDate ?? ""} />
          </label>
          <label className="text-xs font-medium text-stone-600">
            结束日期
            <input className={`${input} mt-1`} type="date" name="endDate" defaultValue={filters.endDate ?? ""} />
          </label>
          <div className="flex items-end gap-2">
            <button className={button}>查询</button>
            <Link href="/v2/audit" className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-white">
              清除
            </Link>
          </div>
        </form>
      </div>

      {result.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-stone-900">当前筛选下没有审计事件</h2>
          <p className="mt-2 text-sm text-stone-500">
            完成采购、验收、订单、制作、交付或成本操作后，关键动作会记录在这里。
          </p>
        </div>
      ) : (
        <div className={tableShell}>
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className={tableHead}>
              <tr>
                <th className="px-4 py-3">发生时间</th>
                <th className="px-4 py-3">操作人</th>
                <th className="px-4 py-3">操作</th>
                <th className="px-4 py-3">对象</th>
                <th className="px-4 py-3">变更摘要</th>
                <th className="px-4 py-3">详情</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {result.rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-stone-50">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-stone-600">
                    {formatDateTimeInAppTimezone(row.occurredAt)}
                    <div className="mt-1 text-[11px] text-stone-400">{row.storeId ? "门店" : "租户"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-stone-800">{row.actorName ?? "—"}</div>
                    <div className="text-xs text-stone-400">{row.actorStaffId ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-800">{row.action}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-stone-800">{row.entityType}</div>
                    <div className="max-w-[220px] break-all text-xs text-stone-500">{row.entityId ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    {row.change.changes.length === 0 ? (
                      <span className="text-xs text-stone-400">{row.change.summary}</span>
                    ) : (
                      <div className="space-y-1">
                        {row.change.changes.slice(0, 3).map((change) => (
                          <div key={change.field} className="flex flex-wrap items-center gap-1 text-xs">
                            <StatusBadge tone={CHANGE_TONE[change.kind]}>
                              {change.kind === "ADDED" ? "新增" : change.kind === "REMOVED" ? "移除" : "修改"}
                            </StatusBadge>
                            <span className="font-medium text-stone-700">{change.field}</span>
                            <span className="text-stone-500">
                              {change.before ?? "—"} → {change.after ?? "—"}
                            </span>
                          </div>
                        ))}
                        {row.change.changes.length > 3 && (
                          <p className="text-xs text-stone-400">等 {row.change.changes.length} 项变更</p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-emerald-700">查看快照</summary>
                      <div className="mt-2 grid gap-3 lg:grid-cols-2">
                        <JsonBlock label="变更前" value={row.beforeSnapshot} />
                        <JsonBlock label="变更后" value={row.afterSnapshot} />
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.pagination.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-stone-600">
          <span>共 {result.pagination.total} 条，每页 {result.pagination.pageSize} 条</span>
          <div className="flex gap-2">
            <Link
              href={buildAuditHref(filters, Math.max(1, result.pagination.page - 1))}
              className={`rounded-lg border border-stone-300 px-3 py-1.5 ${result.pagination.page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-white"}`}
            >
              上一页
            </Link>
            <Link
              href={buildAuditHref(filters, Math.min(result.pagination.totalPages, result.pagination.page + 1))}
              className={`rounded-lg border border-stone-300 px-3 py-1.5 ${result.pagination.page >= result.pagination.totalPages ? "pointer-events-none opacity-40" : "hover:bg-white"}`}
            >
              下一页
            </Link>
          </div>
        </div>
      )}
    </V2ModulePage>
  );
}
