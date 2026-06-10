"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AuditLogTable,
  type AuditLogRow,
} from "@/components/wms/audit/AuditLogTable";
import { PageError, PageLoading } from "@/components/admin/PageState";
import { AUDIT_MODULE_OPTIONS } from "@/lib/audit-labels";
import { fetchAdminApi } from "@/lib/admin-api-client";
import { getTodayAppDateString } from "@/lib/datetime";

type ApiData = {
  logs: AuditLogRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export function AuditLogsClient() {
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [actorId, setActorId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(getTodayAppDateString());
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (module) params.set("module", module);
      if (action.trim()) params.set("action", action.trim());
      if (entityType.trim()) params.set("entityType", entityType.trim());
      if (entityId.trim()) params.set("entityId", entityId.trim());
      if (actorId.trim()) params.set("actorId", actorId.trim());
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      const result = await fetchAdminApi<ApiData>(
        `/api/admin/audit-logs?${params}`
      );
      setData(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "操作日志加载失败，请稍后重试。"
      );
    } finally {
      setLoading(false);
    }
  }, [
    module,
    action,
    entityType,
    entityId,
    actorId,
    startDate,
    endDate,
    page,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold text-zinc-900">操作日志</h2>
        <p className="mt-2 max-w-3xl text-sm text-zinc-500">
          记录关键业务操作，便于追踪谁在什么时候做了什么修改。
        </p>
      </header>

      <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-2 lg:grid-cols-4">
        <select
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          value={module}
          onChange={(e) => {
            setPage(1);
            setModule(e.target.value);
          }}
        >
          <option value="">全部模块</option>
          {AUDIT_MODULE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          placeholder="操作 action"
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
        />
        <input
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          placeholder="对象类型 entityType"
          value={entityType}
          onChange={(e) => {
            setPage(1);
            setEntityType(e.target.value);
          }}
        />
        <input
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          placeholder="对象 ID"
          value={entityId}
          onChange={(e) => {
            setPage(1);
            setEntityId(e.target.value);
          }}
        />
        <input
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          placeholder="操作人 actorId"
          value={actorId}
          onChange={(e) => {
            setPage(1);
            setActorId(e.target.value);
          }}
        />
        <label className="text-xs text-zinc-600">
          开始日期
          <input
            type="date"
            className="mt-1 block w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            value={startDate}
            onChange={(e) => {
              setPage(1);
              setStartDate(e.target.value);
            }}
          />
        </label>
        <label className="text-xs text-zinc-600">
          结束日期
          <input
            type="date"
            className="mt-1 block w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            value={endDate}
            onChange={(e) => {
              setPage(1);
              setEndDate(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="self-end rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white"
          onClick={() => void load()}
        >
          查询
        </button>
      </div>

      {loading ? (
        <PageLoading text="正在加载操作日志…" />
      ) : error ? (
        <PageError error={error} onRetry={() => void load()} />
      ) : (
        <>
          <AuditLogTable logs={data?.logs ?? []} />
          {data && data.pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm text-zinc-600">
              <span>
                第 {data.pagination.page} / {data.pagination.totalPages} 页，共{" "}
                {data.pagination.total} 条
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  className="rounded border px-3 py-1 disabled:opacity-40"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={page >= data.pagination.totalPages}
                  className="rounded border px-3 py-1 disabled:opacity-40"
                  onClick={() =>
                    setPage((p) => Math.min(data.pagination.totalPages, p + 1))
                  }
                >
                  下一页
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
