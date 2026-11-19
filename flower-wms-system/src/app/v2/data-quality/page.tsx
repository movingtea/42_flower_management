import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Context } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { formatDateTimeInAppTimezone } from "@/lib/datetime";
import { canOpenV2Href } from "@/v2/navigation";
import {
  DATA_QUALITY_DOMAINS,
  DATA_QUALITY_DOMAIN_LABELS,
  DATA_QUALITY_SEVERITIES,
  DATA_QUALITY_SEVERITY_LABELS,
  filterDataQualityIssues,
  isDataQualityDomain,
  isDataQualitySeverity,
} from "@/v2/domain/data-quality";
import { collectDataQualityIssues } from "@/v2/services/data-quality";
import { ActionEmptyState, StatusBadge, V2ModulePage, button, card, input, tableHead, tableShell } from "../_components/V2Ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
/** Matches the service default `take`; each check reports at most this many rows. */
const CHECK_DISPLAY_LIMIT = 50;

type Search = {
  severity?: string | string[];
  domain?: string | string[];
  page?: string | string[];
};

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parsePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function buildHref(params: { severity?: string; domain?: string; page?: number }): string {
  const query = new URLSearchParams();
  if (params.severity) query.set("severity", params.severity);
  if (params.domain) query.set("domain", params.domain);
  if (params.page && params.page > 1) query.set("page", String(params.page));
  const serialized = query.toString();
  return serialized ? `/v2/data-quality?${serialized}` : "/v2/data-quality";
}

const SEVERITY_TONE: Record<string, "danger" | "warning" | "info"> = {
  CRITICAL: "danger",
  WARNING: "warning",
  SUGGESTION: "info",
};

export default async function V2DataQualityPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/data-quality");
  }
  const context = await requireV2Context("inventory_review");
  const scope = { tenantId: context.tenantId, storeId: context.storeId };
  const params = await searchParams;
  const severityParam = single(params.severity);
  const domainParam = single(params.domain);
  const severity = isDataQualitySeverity(severityParam) ? severityParam : undefined;
  const domain = isDataQualityDomain(domainParam) ? domainParam : undefined;
  const page = parsePage(single(params.page));

  const result = await collectDataQualityIssues(v2db, scope);
  const filtered = filterDataQualityIssues(result.issues, {
    severity,
    domain,
    page,
    pageSize: PAGE_SIZE,
  });

  const filter = { severity, domain };
  const checksWithIssues = [...result.checks].sort((left, right) => right.issueCount - left.issueCount);

  return (
    <V2ModulePage
      title="数据质量中心"
      description="只读检查 V2 WMS 的租户门店归属、物料与配方、库存数量、采购、订单和成本引用。检查不会自动修复任何数据。"
      actions={
        <>
          <Link href="/v2/setup" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white">
            试运营检查
          </Link>
          <Link href="/v2/inventory" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white">
            库存管理
          </Link>
        </>
      }
    >
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <p className="font-medium">默认只读，不自动修复</p>
        <p className="mt-1">
          本页只汇总异常并链接到对应业务页面，由员工判断后人工处理；正常采购、库存和订单流程不会因检查结果被阻塞。
        </p>
        <p className="mt-1 text-xs text-sky-800">
          生成时间 {formatDateTimeInAppTimezone(result.generatedAt)}
          {result.truncated ? "；部分检查达到展示或扫描上限，异常总数可能更多。" : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className={`${card} border-red-200 bg-red-50/60`}>
          <p className="text-xs text-stone-500">严重</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{result.summary.criticalCount}</p>
          <p className="mt-1 text-xs text-stone-500">需要优先人工处理</p>
        </div>
        <div className={`${card} border-amber-200 bg-amber-50/60`}>
          <p className="text-xs text-stone-500">警告</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{result.summary.warningCount}</p>
        </div>
        <div className={`${card} border-sky-200 bg-sky-50/60`}>
          <p className="text-xs text-stone-500">建议</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{result.summary.suggestionCount}</p>
        </div>
        <div className={card}>
          <p className="text-xs text-stone-500">通过检查</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{result.summary.passedCheckCount}</p>
          <p className="mt-1 text-xs text-stone-500">共 {result.checks.length} 项检查</p>
        </div>
        <div className={card}>
          <p className="text-xs text-stone-500">异常总数（当前展示）</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{result.summary.totalCount}</p>
          <p className="mt-1 text-xs text-stone-500">每项检查最多展示 {CHECK_DISPLAY_LIMIT} 条</p>
        </div>
      </div>

      <section className={`${card} space-y-3`} aria-labelledby="dq-checks-heading">
        <h2 id="dq-checks-heading" className="text-base font-semibold text-stone-900">检查项目</h2>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {checksWithIssues.map((check) => (
            <div key={check.key} className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-stone-800">{check.title}</p>
                <p className="text-xs text-stone-500">{DATA_QUALITY_DOMAIN_LABELS[check.domain]}</p>
              </div>
              <StatusBadge tone={check.issueCount === 0 ? "success" : "warning"}>
                {check.issueCount === 0 ? "通过" : `${check.issueCount} 项`}
              </StatusBadge>
            </div>
          ))}
        </div>
      </section>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <label className="text-xs font-medium text-stone-600">
          严重级别
          <select name="severity" defaultValue={severity ?? ""} className={`${input} mt-1 w-40`}>
            <option value="">全部</option>
            {DATA_QUALITY_SEVERITIES.map((value) => (
              <option key={value} value={value}>{DATA_QUALITY_SEVERITY_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-stone-600">
          领域
          <select name="domain" defaultValue={domain ?? ""} className={`${input} mt-1 w-44`}>
            <option value="">全部</option>
            {DATA_QUALITY_DOMAINS.map((value) => (
              <option key={value} value={value}>{DATA_QUALITY_DOMAIN_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <button className={button}>筛选</button>
        <Link href="/v2/data-quality" className="text-sm text-stone-500 hover:underline">清除筛选</Link>
        <span className="text-xs text-stone-400">显示 {filtered.issues.length} / {filtered.pagination.total} 条</span>
      </form>

      {filtered.issues.length === 0 ? (
        <ActionEmptyState
          title={result.summary.totalCount === 0 ? "当前没有数据质量问题" : "当前筛选下没有问题"}
          description={
            result.summary.totalCount === 0
              ? "主数据、库存、采购和订单引用检查均通过。"
              : "可调整严重级别或领域筛选查看其他问题。"
          }
          actionHref={result.summary.totalCount === 0 ? "/v2/setup" : "/v2/data-quality"}
          actionLabel={result.summary.totalCount === 0 ? "查看试运营检查" : "清除筛选"}
        />
      ) : (
        <div className={tableShell}>
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className={tableHead}>
              <tr>
                <th className="px-4 py-3">严重级别</th>
                <th className="px-4 py-3">领域</th>
                <th className="px-4 py-3">对象</th>
                <th className="px-4 py-3">问题</th>
                <th className="px-4 py-3">处理入口</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.issues.map((issue) => (
                <tr key={issue.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <StatusBadge tone={SEVERITY_TONE[issue.severity] ?? "info"}>
                      {DATA_QUALITY_SEVERITY_LABELS[issue.severity]}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-600">{DATA_QUALITY_DOMAIN_LABELS[issue.domain]}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-stone-800">{issue.entityType}</div>
                    <div className="max-w-[220px] break-all text-xs text-stone-500">{issue.entityId ?? "全局"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-stone-900">{issue.title}</div>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-stone-600">{issue.message}</p>
                  </td>
                  <td className="px-4 py-3">
                    {issue.actionHref && canOpenV2Href(context.roles, issue.actionHref) ? (
                      <Link href={issue.actionHref} className="text-emerald-700 hover:underline">
                        {issue.actionLabel ?? "查看"} →
                      </Link>
                    ) : issue.actionHref ? (
                      <span className="text-xs text-stone-400">需有对应模块权限的同事处理</span>
                    ) : (
                      <span className="text-xs text-stone-400">需人工排查</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.pagination.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-stone-600">
          <span>
            第 {filtered.pagination.page} / {filtered.pagination.totalPages} 页，共 {filtered.pagination.total} 条
          </span>
          <div className="flex gap-2">
            <Link
              href={buildHref({ ...filter, page: Math.max(1, filtered.pagination.page - 1) })}
              className={`rounded-lg border border-stone-300 px-3 py-1.5 ${filtered.pagination.page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-white"}`}
            >
              上一页
            </Link>
            <Link
              href={buildHref({ ...filter, page: Math.min(filtered.pagination.totalPages, filtered.pagination.page + 1) })}
              className={`rounded-lg border border-stone-300 px-3 py-1.5 ${filtered.pagination.page >= filtered.pagination.totalPages ? "pointer-events-none opacity-40" : "hover:bg-white"}`}
            >
              下一页
            </Link>
          </div>
        </div>
      )}
    </V2ModulePage>
  );
}
