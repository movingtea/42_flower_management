"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { fetchAdminApi } from "@/lib/admin-api-client";
import type { SetupChecklistResult } from "@/services/setup-checklist-pure";
import type { DataQualityResult } from "@/services/data-quality-pure";
import type { SystemHealthResult } from "@/services/system-health";
import type { TrialRunCheckResult } from "@/services/trial-run-check";

type PartialState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
};

function statusMessage(
  setup: SetupChecklistResult | null,
  quality: (DataQualityResult & { pagination?: { total: number } }) | null,
  health: SystemHealthResult | null,
  trial: TrialRunCheckResult | null
): string {
  const critical =
    (setup?.summary.criticalCount ?? 0) + (quality?.summary.criticalCount ?? 0);
  if (critical > 0 || health?.status === "ERROR" || trial?.status === "BLOCKED") {
    return "存在严重问题，建议先处理后再接真实订单。";
  }
  if (
    (setup?.summary.completionRate ?? 0) >= 90 &&
    (quality?.summary.criticalCount ?? 0) === 0
  ) {
    return "系统基本具备试运营条件。";
  }
  return "仍有关键数据需要补齐。";
}

export function TrialOperationStatusCard() {
  const [setup, setSetup] = useState<PartialState<SetupChecklistResult>>({
    data: null,
    error: null,
    loading: true,
  });
  const [quality, setQuality] = useState<
    PartialState<DataQualityResult & { pagination: { total: number } }>
  >({ data: null, error: null, loading: true });
  const [health, setHealth] = useState<PartialState<SystemHealthResult>>({
    data: null,
    error: null,
    loading: true,
  });
  const [trial, setTrial] = useState<PartialState<TrialRunCheckResult>>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    void (async () => {
      try {
        setSetup((s) => ({ ...s, loading: true, error: null }));
        const data = await fetchAdminApi<SetupChecklistResult>(
          "/api/admin/setup/checklist"
        );
        setSetup({ data, error: null, loading: false });
      } catch (err) {
        setSetup({
          data: null,
          error: err instanceof Error ? err.message : "加载失败",
          loading: false,
        });
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setQuality((s) => ({ ...s, loading: true, error: null }));
        const data = await fetchAdminApi<
          DataQualityResult & { pagination: { total: number } }
        >("/api/admin/data-quality?pageSize=1");
        setQuality({ data, error: null, loading: false });
      } catch (err) {
        setQuality({
          data: null,
          error: err instanceof Error ? err.message : "加载失败",
          loading: false,
        });
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setHealth((s) => ({ ...s, loading: true, error: null }));
        const data = await fetchAdminApi<SystemHealthResult>(
          "/api/admin/system/health"
        );
        setHealth({ data, error: null, loading: false });
      } catch (err) {
        setHealth({
          data: null,
          error: err instanceof Error ? err.message : "加载失败",
          loading: false,
        });
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setTrial((s) => ({ ...s, loading: true, error: null }));
        const data = await fetchAdminApi<TrialRunCheckResult>(
          "/api/admin/trial-run/check"
        );
        setTrial({ data, error: null, loading: false });
      } catch (err) {
        setTrial({
          data: null,
          error: err instanceof Error ? err.message : "加载失败",
          loading: false,
        });
      }
    })();
  }, []);

  const anyLoading =
    setup.loading || quality.loading || health.loading || trial.loading;
  const partialError =
    setup.error || quality.error || health.error || trial.error;

  return (
    <section className="mb-8 rounded-xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-emerald-900">试运营状态</h3>
          <p className="mt-1 text-sm text-emerald-800/80">
            {anyLoading
              ? "正在加载试运营检查…"
              : statusMessage(setup.data, quality.data, health.data, trial.data)}
          </p>
          {partialError ? (
            <p className="mt-1 text-xs text-amber-800">
              部分检查加载失败，其余数据仍可用。
            </p>
          ) : null}
        </div>
        <Link
          href="/wms/setup"
          className="text-sm font-medium text-emerald-800 hover:underline"
        >
          查看详情 →
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-zinc-500">准备完成率</p>
          <p className="mt-1 text-xl font-semibold text-zinc-900">
            {setup.loading
              ? "…"
              : setup.error
                ? "—"
                : `${setup.data?.summary.completionRate ?? 0}%`}
          </p>
        </div>
        <div className="rounded-lg bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-zinc-500">数据质量</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">
            {quality.loading ? (
              "…"
            ) : quality.error ? (
              "—"
            ) : (
              <>
                严重 {quality.data?.summary.criticalCount ?? 0} · 警告{" "}
                {quality.data?.summary.warningCount ?? 0}
              </>
            )}
          </p>
        </div>
        <div className="rounded-lg bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-zinc-500">系统健康</p>
          <div className="mt-1">
            {health.loading ? (
              <span className="text-zinc-400">…</span>
            ) : health.error ? (
              <span className="text-zinc-400">—</span>
            ) : health.data ? (
              <StatusBadge status={health.data.status} />
            ) : null}
          </div>
        </div>
        <div className="rounded-lg bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-zinc-500">链路检查</p>
          <div className="mt-1">
            {trial.loading ? (
              <span className="text-zinc-400">…</span>
            ) : trial.error ? (
              <span className="text-zinc-400">—</span>
            ) : trial.data ? (
              <StatusBadge status={trial.data.status} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/wms/setup"
          className="rounded-lg bg-emerald-800 px-3 py-2 text-sm text-white hover:bg-emerald-900"
        >
          查看试运营准备
        </Link>
        <Link
          href="/wms/data-quality"
          className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-900 hover:bg-emerald-50"
        >
          查看数据质量
        </Link>
        <Link
          href="/wms/system-health"
          className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-900 hover:bg-emerald-50"
        >
          查看系统健康
        </Link>
      </div>
    </section>
  );
}
