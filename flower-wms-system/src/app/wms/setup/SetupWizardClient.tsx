"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MetricCard } from "@/components/admin/MetricCard";
import { PageError, PageLoading } from "@/components/admin/PageState";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { SetupChecklistSection } from "@/components/wms/setup/SetupChecklistSection";
import { fetchAdminApi } from "@/lib/admin-api-client";
import type { SetupChecklistResult } from "@/services/setup-checklist-pure";
import type { TrialRunCheckResult } from "@/services/trial-run-check";

function completionHint(summary: SetupChecklistResult["summary"]): string {
  if (summary.criticalCount > 0) {
    return "仍有关键问题需要处理，建议先补齐后再接真实订单。";
  }
  if (summary.completionRate >= 90) {
    return "基本可以试运营，建议完成剩余检查项并跑一笔测试订单。";
  }
  if (summary.completionRate < 60) {
    return "基础配置还不完整，请按下方建议逐项补齐。";
  }
  return "部分配置仍需关注，建议继续完善后再扩大试运营。";
}

export function SetupWizardClient() {
  const [checklist, setChecklist] = useState<SetupChecklistResult | null>(
    null
  );
  const [trial, setTrial] = useState<TrialRunCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [trialLoading, setTrialLoading] = useState(false);
  const [error, setError] = useState("");

  const loadChecklist = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminApi<SetupChecklistResult>(
        "/api/admin/setup/checklist"
      );
      setChecklist(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "试运营准备加载失败，请稍后重试。"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrial = useCallback(async () => {
    setTrialLoading(true);
    try {
      const data = await fetchAdminApi<TrialRunCheckResult>(
        "/api/admin/trial-run/check"
      );
      setTrial(data);
    } catch {
      /* trial-run 失败不阻塞主清单 */
    } finally {
      setTrialLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadChecklist(), loadTrial()]);
  }, [loadChecklist, loadTrial]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  if (loading) {
    return <PageLoading text="正在加载试运营准备清单…" />;
  }

  if (error || !checklist) {
    return <PageError error={error} onRetry={() => void loadAll()} />;
  }

  const { summary } = checklist;

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-semibold text-zinc-900">试运营准备</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-500">
          在正式开始接真实订单前，先检查花材、供应商、配方、商品、小程序首页、CRM
          和报表链路是否准备好。
        </p>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-zinc-900">总体完成度</p>
            <p className="mt-1 text-sm text-zinc-500">
              {completionHint(summary)}
            </p>
          </div>
          <p className="text-3xl font-semibold text-zinc-900">
            {summary.completionRate}%
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="总检查项" value={summary.totalItems} />
          <MetricCard
            label="已通过"
            value={summary.passedCount}
            tone="success"
          />
          <MetricCard
            label="需关注"
            value={summary.warningCount}
            tone="warning"
          />
          <MetricCard
            label="严重问题"
            value={summary.criticalCount}
            tone="danger"
          />
          <MetricCard
            label="完成率"
            value={`${summary.completionRate}%`}
          />
        </div>
      </section>

      {checklist.nextActions.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-amber-900">下一步建议</h3>
          <ul className="mt-3 space-y-2">
            {checklist.nextActions.map((action) => (
              <li key={`${action.title}-${action.actionHref}`}>
                <Link
                  href={action.actionHref}
                  className="text-sm text-amber-900 hover:underline"
                >
                  • {action.title} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="space-y-4">
        {checklist.sections.map((section) => (
          <SetupChecklistSection key={section.key} section={section} />
        ))}
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">
              试运行完整链路
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              检查 WMS → CMS → 小程序 → 订单 → CRM → 报表是否具备试运行条件（默认不创建测试订单）。
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            onClick={() => void loadTrial()}
            disabled={trialLoading}
          >
            {trialLoading ? "检查中…" : "重新检查"}
          </button>
        </div>

        {trial ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={trial.status} />
              {trial.recommendedTestProduct ? (
                <span className="text-sm text-zinc-600">
                  推荐测试商品：{trial.recommendedTestProduct.name}
                </span>
              ) : null}
            </div>
            <ul className="space-y-2">
              {trial.steps.map((step) => (
                <li
                  key={step.key}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50/50 px-3 py-2 text-sm"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-900">
                        {step.title}
                      </span>
                      <StatusBadge
                        status={
                          step.status === "PASS"
                            ? "PASS"
                            : step.status === "WARNING"
                              ? "WARNING"
                              : "BLOCKED"
                        }
                      />
                    </div>
                    <p className="mt-1 text-zinc-600">{step.message}</p>
                  </div>
                  {step.actionHref ? (
                    <Link
                      href={step.actionHref}
                      className="shrink-0 text-emerald-700 hover:underline"
                    >
                      前往 →
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
            {trial.warnings.length > 0 ? (
              <ul className="mt-4 space-y-1 text-sm text-amber-800">
                {trial.warnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-zinc-500">链路检查尚未加载。</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/wms/data-quality"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800"
          >
            查看数据质量问题
          </Link>
          <Link
            href="/cms/products"
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            查看小程序商品
          </Link>
          <Link
            href="/wms/reports"
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            查看报表
          </Link>
        </div>
      </section>
    </div>
  );
}
