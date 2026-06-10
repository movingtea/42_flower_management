"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageError, PageLoading } from "@/components/admin/PageState";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { fetchAdminApi } from "@/lib/admin-api-client";
import { formatDateTime } from "@/lib/format-display";
import type { SystemHealthResult } from "@/services/system-health";

function mapCheckStatus(
  status: string
): "OK" | "WARNING" | "ERROR" | "UNKNOWN" {
  if (status === "OK") return "OK";
  if (status === "WARNING") return "WARNING";
  if (status === "ERROR") return "ERROR";
  return "UNKNOWN";
}

export function SystemHealthClient() {
  const [health, setHealth] = useState<SystemHealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminApi<SystemHealthResult>(
        "/api/admin/system/health"
      );
      setHealth(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "系统健康检查加载失败，请稍后重试。"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">系统健康检查</h2>
          <p className="mt-2 max-w-3xl text-sm text-zinc-500">
            检查数据库、上传目录、关键环境变量和核心服务状态。不会展示密钥明文。
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          onClick={() => void load()}
          disabled={loading}
        >
          重新检查
        </button>
      </header>

      {loading ? (
        <PageLoading text="正在检查系统健康…" />
      ) : error ? (
        <PageError error={error} onRetry={() => void load()} />
      ) : health ? (
        <>
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={health.status} />
              <span className="text-sm text-zinc-500">
                生成于 {formatDateTime(health.generatedAt)}
              </span>
            </div>
          </section>

          <ul className="space-y-3">
            {health.checks.map((check) => (
              <li
                key={check.key}
                className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-zinc-900">{check.title}</h3>
                  <StatusBadge status={mapCheckStatus(check.status)} />
                </div>
                <p className="mt-2 text-sm text-zinc-600">{check.message}</p>
                {check.metadata && Object.keys(check.metadata).length > 0 ? (
                  <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    {Object.entries(check.metadata).map(([key, val]) => (
                      <div key={key}>
                        <span className="text-zinc-400">{key}：</span>
                        <span>{String(val)}</span>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/wms/data-quality"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800"
            >
              查看数据质量
            </Link>
            <Link
              href="/wms/setup"
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              查看试运营准备
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
