"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProductDecisionApiResponse, ProductDecisionItem } from "@/lib/product-decision-types";
import { ProductDecisionDetailDrawer } from "./ProductDecisionDetailDrawer";
import { ProductDecisionRankings } from "./ProductDecisionRankings";
import { ProductDecisionSummaryCards } from "./ProductDecisionSummaryCards";
import { ProductDecisionTable } from "./ProductDecisionTable";
import { Section, WarningList } from "./report-ui";

export function ProductDecisionTab({
  query,
  productId,
}: {
  query: string;
  productId?: string | null;
}) {
  const [data, setData] = useState<ProductDecisionApiResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ProductDecisionItem | null>(null);

  const requestQuery = useMemo(() => {
    const params = new URLSearchParams(query);
    params.set("limit", params.get("limit") || "50");
    params.set("includeInactive", "true");
    if (productId) {
      params.set("productId", productId);
      params.set("includeAll", "true");
    }
    return params.toString();
  }, [productId, query]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/product-decisions?${requestQuery}`);
      const json = (await res.json()) as ProductDecisionApiResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "加载产品决策数据失败");
      }
      setData(json.data);
      if (productId && json.data.products.length === 1) {
        setSelectedItem(json.data.products[0]);
      }
    } catch (err) {
      console.error("[product-decision-ui]", err);
      setError("产品决策数据加载失败，请稍后重试。");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [productId, requestQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReport();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReport]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 shadow-sm">
        正在加载产品决策数据...
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

  const hasSales = data.summary.totalOrderCount > 0;
  const hasIncomplete = data.summary.incompleteDataCount > 0;
  const targetMargin = Number(new URLSearchParams(requestQuery).get("targetMargin") || 0.6);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">产品决策中心</h3>
        <p className="mt-2 text-sm text-zinc-600">
          基于产品配方、损耗成本模型、历史销售和毛利表现，帮助判断哪些产品值得主推、哪些需要调价、哪些应继续观察或优化配方。
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          产品决策标签只作为经营建议，不会自动改价、下架或修改配方。
        </p>
        {data.dateRange?.label ? (
          <p className="mt-3 text-xs text-zinc-400">当前范围：{data.dateRange.label}</p>
        ) : null}
      </section>

      <WarningList warnings={[...data.warnings, ...data.summary.warnings]} />

      {!hasSales ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
          当前时间范围内暂无销售数据，系统将基于配方和损耗模型提供预估建议。
        </div>
      ) : null}

      {hasIncomplete ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          部分 SKU 未绑定配方或缺少标准成本，无法生成完整产品决策。
        </div>
      ) : null}

      <Section title="产品决策概览" description="汇总当前范围内 SKU 的经营健康状态。">
        <ProductDecisionSummaryCards summary={data.summary} />
      </Section>

      <Section
        title="产品经营状态"
        description="按 SKU 展示产品销售、毛利模拟、损耗敏感度、建议售价和经营标签。"
      >
        <ProductDecisionTable
          products={data.products}
          targetMargin={targetMargin}
          onViewDetail={setSelectedItem}
        />
      </Section>

      <ProductDecisionRankings rankings={data.rankings} targetMargin={targetMargin} />

      <ProductDecisionDetailDrawer
        item={selectedItem}
        targetMargin={targetMargin}
        onClose={() => setSelectedItem(null)}
      />
    </div>
  );
}
