"use client";

import { useCallback, useEffect, useState } from "react";
import type { PurchaseAnalyticsReport } from "@/lib/purchase-analytics-types";
import { BatchCostContributionTable } from "./BatchCostContributionTable";
import { BatchSalesConversionTable } from "./BatchSalesConversionTable";
import { FlowerPriceTrendTable } from "./FlowerPriceTrendTable";
import { PurchaseAnalyticsSummaryCards } from "./PurchaseAnalyticsSummaryCards";
import { PurchaseRecommendationCards } from "./PurchaseRecommendationCards";
import { Section, WarningList } from "./report-ui";
import { SupplierRankingTable } from "./SupplierRankingTable";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export function PurchaseAnalyticsTab({ query }: { query: string }) {
  const [data, setData] = useState<PurchaseAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/purchase-analytics?${query}`);
      const json = (await res.json()) as ApiResponse<PurchaseAnalyticsReport>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "加载采购复盘数据失败");
      }
      setData(json.data);
    } catch (err) {
      console.error("[purchase-analytics-ui]", err);
      setError("采购复盘数据加载失败，请稍后重试。");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReport();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReport]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 shadow-sm">
        正在加载采购复盘数据...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
        {error}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const isEmpty =
    data.summary.receivedPurchaseOrderCount === 0 &&
    data.supplierRanking.length === 0 &&
    data.flowerPriceTrends.length === 0;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">采购复盘与供应商分析</h3>
        <p className="mt-2 text-sm text-zinc-600">
          基于采购单、批次库存、销售出库和损耗成本模型，帮助判断这批花买得值不值、供应商是否稳定、哪些花材应该多买或谨慎采购。
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          帮助判断采购是否真正转化为利润。这里的损耗影响来自 Sprint 5 的可用率模型，不等同于真实报损流水。
        </p>
        {data.dateRange?.label && (
          <p className="mt-3 text-xs text-zinc-400">当前范围：{data.dateRange.label}</p>
        )}
      </section>

      <WarningList warnings={[...data.warnings, ...data.summary.warnings]} />

      {isEmpty ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 shadow-sm">
          当前时间范围内暂无已入库采购单。
        </div>
      ) : (
        <>
          <Section
            title="采购概览"
            description="汇总当前时间范围内已入库采购的金额、支数与损耗模型影响。"
          >
            <PurchaseAnalyticsSummaryCards summary={data.summary} />
          </Section>

          <Section
            title="供应商采购排行"
            description="查看采购金额主要集中在哪些供应商，以及损耗模型对供应商成本的影响。"
          >
            <SupplierRankingTable rows={data.supplierRanking} />
          </Section>

          <Section
            title="花材采购价趋势"
            description="对比最近一次与上一次采购成本，识别涨价、降价和数据不足的花材。"
          >
            <FlowerPriceTrendTable rows={data.flowerPriceTrends} />
          </Section>

          <Section
            title="批次销售转化"
            description="查看一批花从入库到销售、报损、剩余的转化情况。实际报损率来自真实报损流水；损耗模型是经营估算，两者口径不同。"
          >
            <BatchSalesConversionTable rows={data.batchSalesConversion} />
          </Section>

          <Section
            title="批次销售成本贡献"
            description="基于销售出库记录，查看不同批次对订单花材成本的贡献。这里只统计销售出库对应的花材成本，不分摊订单收入，因此不是批次毛利。"
          >
            <BatchCostContributionTable rows={data.batchCostContribution} />
          </Section>

          <Section
            title="采购建议"
            description="根据供应商稳定性、价格波动、批次剩余和损耗影响整理的轻量建议，不自动生成采购计划。"
          >
            <PurchaseRecommendationCards report={data} />
          </Section>
        </>
      )}
    </div>
  );
}
