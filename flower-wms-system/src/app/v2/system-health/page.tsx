import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { formatDateTimeInAppTimezone } from "@/lib/datetime";
import type { HealthCheckStatus } from "@/v2/domain/system-health";
import { getV2SystemHealth } from "@/v2/services/system-health";
import { StatusBadge, V2ModulePage, card, tableHead, tableShell } from "../_components/V2Ui";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<HealthCheckStatus, string> = {
  OK: "正常",
  WARNING: "注意",
  ERROR: "异常",
  UNKNOWN: "未知",
};

const STATUS_TONE: Record<HealthCheckStatus, "success" | "warning" | "danger" | "neutral"> = {
  OK: "success",
  WARNING: "warning",
  ERROR: "danger",
  UNKNOWN: "neutral",
};

const OVERALL_LABEL: Record<"OK" | "WARNING" | "ERROR", string> = {
  OK: "正常",
  WARNING: "需要关注",
  ERROR: "存在异常",
};

function metadataText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return "—";
  return Object.entries(metadata)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}=${value.length}`;
      return `${key}=${String(value)}`;
    })
    .join(" · ");
}

export default async function V2SystemHealthPage() {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/system-health");
  }
  await requireV2Store("staff");
  const health = await getV2SystemHealth(v2db);

  return (
    <V2ModulePage
      title="系统健康"
      description="检查 V2 数据库、迁移状态、关键环境变量、对象存储与磁盘，并核对关键业务数据。页面只读，不返回任何密钥明文。"
      actions={
        <>
          <Link href="/v2/setup" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white">
            试运营检查
          </Link>
          <Link href="/v2/reports" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white">
            报表中心
          </Link>
        </>
      }
    >
      <section className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <h2 className="text-lg font-semibold text-stone-900">总体状态</h2>
          <p className="mt-1 text-sm text-stone-500">检查时间 {formatDateTimeInAppTimezone(health.generatedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={STATUS_TONE[health.status]}>
            {OVERALL_LABEL[health.status]}
          </StatusBadge>
          <span className="text-xs text-stone-400">{health.checks.length} 项检查</span>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(["OK", "WARNING", "ERROR", "UNKNOWN"] as const).map((status) => {
          const count = health.checks.filter((check) => check.status === status).length;
          return (
            <div key={status} className={card}>
              <p className="text-xs text-stone-500">{STATUS_LABEL[status]}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{count}</p>
              <p className="mt-1 text-xs text-stone-500">检查项</p>
            </div>
          );
        })}
      </div>

      <div className={tableShell}>
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className={tableHead}>
            <tr>
              <th className="px-4 py-3">检查项</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">说明</th>
              <th className="px-4 py-3">元数据</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {health.checks.map((check) => (
              <tr key={check.key} className="hover:bg-stone-50">
                <td className="px-4 py-3 font-medium text-stone-900">{check.title}</td>
                <td className="px-4 py-3">
                  <StatusBadge tone={STATUS_TONE[check.status]}>{STATUS_LABEL[check.status]}</StatusBadge>
                </td>
                <td className="px-4 py-3 text-sm leading-6 text-stone-700">{check.message}</td>
                <td className="px-4 py-3 text-xs leading-5 text-stone-500">{metadataText(check.metadata)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {health.migrationState && (
        <section className={`${card} space-y-3`} aria-labelledby="migration-detail-heading">
          <h2 id="migration-detail-heading" className="text-base font-semibold text-stone-900">V2 迁移详情</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-stone-200 p-3 text-sm">
              <p className="text-xs text-stone-500">最新代码迁移</p>
              <p className="mt-1 break-all font-medium">{health.migrationState.latestLocal ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-stone-200 p-3 text-sm">
              <p className="text-xs text-stone-500">最新已应用迁移</p>
              <p className="mt-1 break-all font-medium">{health.migrationState.latestApplied ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-stone-200 p-3 text-sm">
              <p className="text-xs text-stone-500">待应用</p>
              <p className="mt-1 font-medium">{health.migrationState.pending.length}</p>
            </div>
            <div className="rounded-lg border border-stone-200 p-3 text-sm">
              <p className="text-xs text-stone-500">失败 / 回滚</p>
              <p className="mt-1 font-medium">{health.migrationState.failed.length}</p>
            </div>
          </div>
          {health.migrationState.pending.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              待应用：{health.migrationState.pending.join("、")}。请在部署窗口执行 npm run db:v2:migrate:deploy，不要在本页直接操作数据库。
            </p>
          )}
          {health.migrationState.appliedNotInCode.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              数据库多出迁移：{health.migrationState.appliedNotInCode.join("、")}，请确认当前部署版本与数据库版本一致。
            </p>
          )}
        </section>
      )}

      <p className="text-xs text-stone-400">
        本页只读展示运行状态，不执行迁移、不修改环境变量、不清理磁盘；生产发布仍按部署 runbook 执行。
      </p>
    </V2ModulePage>
  );
}
