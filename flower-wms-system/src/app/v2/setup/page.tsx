import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Context } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { formatDateTimeInAppTimezone } from "@/lib/datetime";
import { canOpenV2Href } from "@/v2/navigation";
import type { SetupCheckStatus } from "@/v2/domain/setup-checklist";
import { loadSetupChecklist } from "@/v2/services/setup-checklist";
import { StatusBadge, V2ModulePage, card } from "../_components/V2Ui";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<SetupCheckStatus, string> = {
  PASS: "通过",
  WARNING: "待处理",
  CRITICAL: "阻断",
  NOT_STARTED: "未开始",
};

const STATUS_TONE: Record<SetupCheckStatus, "success" | "warning" | "danger" | "neutral"> = {
  PASS: "success",
  WARNING: "warning",
  CRITICAL: "danger",
  NOT_STARTED: "neutral",
};

export default async function V2SetupPage() {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/setup");
  }
  const context = await requireV2Context("read");
  const data = await loadSetupChecklist(v2db, {
    tenantId: context.tenantId,
    storeId: context.storeId,
  });
  const canQuality = context.capabilities.includes("inventory_review");
  const canHealth = context.capabilities.includes("staff");
  const canOpen = (href: string) => canOpenV2Href(context.roles, href);
  const nextActions = data.result.nextActions.filter((action) => canOpen(action.actionHref));

  return (
    <V2ModulePage
      title="试运营检查"
      description="检查 V2 WMS 主数据、商品配方、采购库存订单链路和上线准备状态。检查只读，不会自动修改业务数据。"
      actions={
        <>
          <Link href="/v2/reports" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white">
            报表中心
          </Link>
          <Link href="/v2" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">
            返回经营概览
          </Link>
        </>
      }
    >
      <section className={`${card} space-y-4`} aria-labelledby="setup-summary-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="setup-summary-heading" className="text-lg font-semibold text-stone-900">
              上线准备总览
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              生成时间 {formatDateTimeInAppTimezone(data.generatedAt)}；当前门店 {context.storeId.slice(0, 8)}…
            </p>
          </div>
          <StatusBadge tone={STATUS_TONE[data.result.summary.overallStatus]}>
            总体：{STATUS_LABEL[data.result.summary.overallStatus]}
          </StatusBadge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-stone-200 p-4">
            <p className="text-xs text-stone-500">完成率</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{data.result.summary.completionRate}%</p>
            <p className="mt-1 text-xs text-stone-500">{data.result.summary.passedCount}/{data.result.summary.totalItems} 项通过</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-xs text-stone-500">待处理</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{data.result.summary.warningCount}</p>
            <p className="mt-1 text-xs text-stone-500">不会阻断录入，但建议上线前确认</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
            <p className="text-xs text-stone-500">阻断或未开始</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{data.result.summary.criticalCount}</p>
            <p className="mt-1 text-xs text-stone-500">需要先补齐的业务前置条件</p>
          </div>
          <div className="rounded-xl border border-stone-200 p-4">
            <p className="text-xs text-stone-500">严重数据质量问题</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{data.stats.criticalDataQualityCount}</p>
            <p className="mt-1 text-xs text-stone-500">
              {data.dataQualityTruncated ? "检查结果已截断，请到数据质量页查看" : "来自只读数据质量检查"}
            </p>
          </div>
        </div>
        {nextActions.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-950">优先处理</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {nextActions.map((action) => (
                <li key={`${action.title}:${action.actionHref}`}>
                  <Link href={action.actionHref} className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100">
                    {action.title} →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {data.result.sections.map((section) => (
        <section key={section.key} className={`${card} space-y-4`} aria-labelledby={`setup-${section.key}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id={`setup-${section.key}`} className="text-base font-semibold text-stone-900">{section.title}</h2>
              <p className="mt-1 text-sm text-stone-500">{section.description}</p>
            </div>
            <StatusBadge tone={STATUS_TONE[section.status]}>{STATUS_LABEL[section.status]}</StatusBadge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {section.items.map((item) => (
              <div key={item.key} className="rounded-xl border border-stone-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium text-stone-900">{item.title}</p>
                  <StatusBadge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</StatusBadge>
                </div>
                <p className="mt-2 text-sm leading-6 text-stone-600">{item.message}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {item.actionHref && item.actionLabel && canOpen(item.actionHref) && (
                    <Link href={item.actionHref} className="text-xs font-medium text-emerald-700 hover:underline">
                      {item.actionLabel} →
                    </Link>
                  )}
                  {item.metrics && (
                    <span className="text-[11px] text-stone-400">
                      {Object.entries(item.metrics).map(([key, value]) => `${key}=${String(value)}`).join(" · ")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className={`${card} flex flex-wrap items-center gap-3`}>
        <p className="text-sm text-stone-600">继续检查：</p>
        {canQuality && (
          <Link href="/v2/data-quality" className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50">
            数据质量中心
          </Link>
        )}
        {canHealth && (
          <Link href="/v2/system-health" className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50">
            系统健康
          </Link>
        )}
        <Link href="/v2/reports?tab=cost" className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-white">
          成本快照报表
        </Link>
        {canHealth && (
          <Link href="/v2/audit" className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-white">
            操作日志
          </Link>
        )}
      </section>
      <p className="text-xs text-stone-400">
        检查基于当前 V2 数据快照，不代表真实业务验收通过；正常业务流程不会因本页检查被阻塞。
      </p>
    </V2ModulePage>
  );
}
