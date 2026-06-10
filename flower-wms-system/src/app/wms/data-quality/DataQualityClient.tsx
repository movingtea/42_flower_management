"use client";

import { useCallback, useEffect, useState } from "react";
import { ActionEmptyState } from "@/components/admin/ActionEmptyState";
import { MetricCard } from "@/components/admin/MetricCard";
import { PageError, PageLoading } from "@/components/admin/PageState";
import { DataQualityIssueCard } from "@/components/wms/data-quality/DataQualityIssueCard";
import { fetchAdminApi } from "@/lib/admin-api-client";
import type { DataQualityResult } from "@/services/data-quality-pure";

const SEVERITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "全部严重程度" },
  { value: "CRITICAL", label: "严重问题" },
  { value: "WARNING", label: "警告" },
  { value: "SUGGESTION", label: "建议优化" },
];

const DOMAIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "全部领域" },
  { value: "WMS", label: "WMS" },
  { value: "CMS", label: "CMS" },
  { value: "MINIPROGRAM", label: "小程序" },
  { value: "ORDER", label: "订单" },
  { value: "CRM", label: "CRM" },
  { value: "REPORT", label: "报表" },
  { value: "SYSTEM", label: "系统" },
];

type ApiData = DataQualityResult & {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export function DataQualityClient() {
  const [severity, setSeverity] = useState("");
  const [domain, setDomain] = useState("");
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
      if (severity) params.set("severity", severity);
      if (domain) params.set("domain", domain);

      const result = await fetchAdminApi<ApiData>(
        `/api/admin/data-quality?${params}`
      );
      setData(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "数据质量检查加载失败，请稍后重试。"
      );
    } finally {
      setLoading(false);
    }
  }, [severity, domain, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold text-zinc-900">数据质量中心</h2>
        <p className="mt-2 max-w-3xl text-sm text-zinc-500">
          检查可能影响成本、库存、小程序展示、CRM 和报表准确性的数据问题。
        </p>
      </header>

      <div className="flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <select
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          value={severity}
          onChange={(e) => {
            setPage(1);
            setSeverity(e.target.value);
          }}
        >
          {SEVERITY_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          value={domain}
          onChange={(e) => {
            setPage(1);
            setDomain(e.target.value);
          }}
        >
          {DOMAIN_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white"
          onClick={() => void load()}
        >
          刷新
        </button>
      </div>

      {loading ? (
        <PageLoading text="正在扫描数据质量…" />
      ) : error ? (
        <PageError error={error} onRetry={() => void load()} />
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="严重问题"
              value={data.summary.criticalCount}
              tone="danger"
            />
            <MetricCard
              label="警告"
              value={data.summary.warningCount}
              tone="warning"
            />
            <MetricCard
              label="建议优化"
              value={data.summary.suggestionCount}
              tone="default"
            />
            <MetricCard
              label="问题总数"
              value={data.pagination.total}
            />
          </div>

          {data.issues.length === 0 ? (
            <ActionEmptyState
              title="数据质量良好"
              description="当前没有发现数据质量问题，可以继续进行试运营准备。"
              primaryActionLabel="查看试运营准备"
              primaryActionHref="/wms/setup"
            />
          ) : (
            <div className="space-y-3">
              {data.issues.map((issue) => (
                <DataQualityIssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          )}

          {data.pagination.totalPages > 1 ? (
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
      ) : null}
    </div>
  );
}
