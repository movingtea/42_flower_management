import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SamplePlanState, SampleState } from "@/generated/prisma-v2/client";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { getSampleReport } from "@/v2/services/sample-reporting";
import {
  V2ModulePage,
  StatusBadge,
} from "../_components/V2Ui";

export const dynamic = "force-dynamic";

const PLAN_STATE_LABELS: Record<SamplePlanState, string> = {
  DRAFT: "草稿",
  PROPOSED: "已算方案",
  APPROVED: "已批准",
  PAUSED: "已暂停",
  IN_PROGRESS: "制作中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

const SAMPLE_STATE_LABELS: Record<SampleState, string> = {
  DRAFT: "草稿",
  READY: "已完成",
  ARCHIVED: "已归档",
};

function money(value: number): string {
  return `¥${value.toFixed(2)}`;
}

function rate(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export default async function SampleReportsPage() {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/sample-reports");
  }
  const scope = await requireV2Store("read");
  const report = await getSampleReport(v2db, { tenantId: scope.tenantId, storeId: scope.storeId });
  const summary = report.summary;

  return (
    <V2ModulePage
      title="样品报表"
      description="样品复用、转化率和成本偏差。计划成本取所选方案，实际成本取执行步骤领用批次成本；未执行计划不参与成本偏差。"
      actions={<Link className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700" href="/v2/samples">返回样品库</Link>}
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">样品 / 已完成</div>
          <div className="mt-1 text-2xl font-semibold">{summary.sampleCount} / {summary.readySampleCount}</div>
          <div className="mt-1 text-xs text-stone-500">已转 SKU {summary.convertedSampleCount} 个样品，共 {summary.sampleSkuCount} 个 SKU</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">样品转化率</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700">{rate(summary.conversionRate)}</div>
          <div className="mt-1 text-xs text-stone-500">已转 SKU 样品 ÷ 已完成/归档样品</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">计划 / 实际成本</div>
          <div className="mt-1 text-2xl font-semibold">{money(summary.plannedCost)}</div>
          <div className="mt-1 text-xs text-stone-500">实际 {money(summary.actualCost)}，偏差 {money(summary.costVariance.variance)}（{rate(summary.costVariance.varianceRate)}）</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">计划 / 实际复用率</div>
          <div className="mt-1 text-2xl font-semibold text-sky-700">{rate(summary.plannedReuseRate)} / {rate(summary.actualReuseRate)}</div>
          <div className="mt-1 text-xs text-stone-500">按成本加权；计划 {summary.planCount} 个，完成 {summary.completedPlanCount} 个</div>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="font-semibold">打样计划成本与复用</h3>
        {report.plans.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">还没有打样计划。</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs text-stone-500">
                <tr>
                  <th className="px-3 py-2">计划</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">样品 / 已转 SKU</th>
                  <th className="px-3 py-2">计划成本</th>
                  <th className="px-3 py-2">实际成本</th>
                  <th className="px-3 py-2">偏差</th>
                  <th className="px-3 py-2">计划复用</th>
                  <th className="px-3 py-2">实际复用</th>
                </tr>
              </thead>
              <tbody>
                {report.plans.map((plan) => (
                  <tr key={plan.id} className="border-t border-stone-100">
                    <td className="px-3 py-2">{plan.name}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={plan.state === SamplePlanState.COMPLETED ? "success" : plan.state === SamplePlanState.CANCELLED ? "neutral" : plan.state === SamplePlanState.PAUSED ? "warning" : "info"}>
                        {PLAN_STATE_LABELS[plan.state]}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2">{plan.sampleCount} / {plan.convertedSkuCount}</td>
                    <td className="px-3 py-2">{money(plan.plannedCost)}</td>
                    <td className="px-3 py-2">{plan.actualCost === null ? "—" : money(plan.actualCost)}</td>
                    <td className={`px-3 py-2 ${plan.variance.overBudget ? "text-red-700" : "text-stone-700"}`}>
                      {money(plan.variance.variance)}
                      <span className="ml-1 text-xs text-stone-500">({rate(plan.variance.varianceRate)})</span>
                    </td>
                    <td className="px-3 py-2">{rate(plan.plannedReuseRate)}</td>
                    <td className="px-3 py-2">{rate(plan.actualReuseRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="font-semibold">样品转化与标准成本</h3>
        {report.samples.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">还没有样品。</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs text-stone-500">
                <tr>
                  <th className="px-3 py-2">样品</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">物料</th>
                  <th className="px-3 py-2">标准成本</th>
                  <th className="px-3 py-2">目标毛利率 / 建议售价</th>
                  <th className="px-3 py-2">SKU（启用）</th>
                  <th className="px-3 py-2">计划数</th>
                </tr>
              </thead>
              <tbody>
                {report.samples.map((sample) => (
                  <tr key={sample.id} className="border-t border-stone-100">
                    <td className="px-3 py-2">
                      <div>{sample.name}</div>
                      <div className="font-mono text-xs text-stone-500">{sample.code}</div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={sample.state === SampleState.READY ? "success" : sample.state === SampleState.ARCHIVED ? "neutral" : "warning"}>
                        {SAMPLE_STATE_LABELS[sample.state]}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2">{sample.materialCount}</td>
                    <td className="px-3 py-2">{money(sample.standardCost)}</td>
                    <td className="px-3 py-2">
                      {sample.targetMarginRate === null ? "—" : `${(sample.targetMarginRate * 100).toFixed(1)}%`}
                      <span className="ml-1 text-xs text-stone-500">{sample.suggestedPrice === null ? "" : money(sample.suggestedPrice)}</span>
                    </td>
                    <td className="px-3 py-2">{sample.skuCount}（{sample.activeSkuCount}）</td>
                    <td className="px-3 py-2">{sample.planCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-stone-500">生成时间：{report.generatedAt.toISOString().slice(0, 19).replace("T", " ")}</p>
    </V2ModulePage>
  );
}
