"use client";

import Link from "next/link";
import {useCallback, useState} from "react";
import { useDeferredEffect } from "@/lib/defer-effect";
import { ProductDecisionHealthBadge } from "@/components/product-decision/ProductDecisionBadge";
import { ProductDecisionTags } from "@/components/product-decision/ProductDecisionTags";
import { formatNullable, formatNumber } from "@/lib/format-display";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import {
  getSuggestedPriceAtTarget,
  pickKeyDecisionTags,
} from "@/lib/product-decision-tags";
import type {
  ProductDecisionApiResponse,
  ProductDecisionItem,
} from "@/lib/product-decision-types";

export function ProductDecisionPanel({
  productId,
  compact = false,
}: {
  productId: string;
  compact?: boolean;
}) {
  const [items, setItems] = useState<ProductDecisionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(!compact);

  const loadDecisions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        productId,
        limit: "20",
        includeInactive: "true",
        includeAll: "true",
      });
      const res = await fetch(`/api/admin/reports/product-decisions?${params}`);
      const json = (await res.json()) as ProductDecisionApiResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "加载产品决策失败");
      }
      setItems(json.data.products);
    } catch (err) {
      console.error("[product-decision-panel]", err);
      setError("产品决策数据加载失败，请稍后重试。");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useDeferredEffect(() => loadDecisions(), [loadDecisions]);

  if (loading) {
    return <p className="text-sm text-zinc-500">正在加载产品决策建议…</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {error}
        <Link
          href={`/wms/reports?tab=product-decisions&productId=${productId}`}
          className="ml-2 text-rose-600 hover:underline"
        >
          前往产品决策中心
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        暂无产品决策数据。
        <Link
          href={`/wms/reports?tab=product-decisions&productId=${productId}`}
          className="ml-1 text-rose-600 hover:underline"
        >
          查看产品决策中心
        </Link>
      </p>
    );
  }

  const content = (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        产品决策基于配方成本、损耗模型和销售表现，仅作为运营建议，不会自动改价、下架或修改配方。
      </p>
      {items.map((item) => {
        const suggestedPrice = getSuggestedPriceAtTarget(item.suggestedPrices, 0.6);
        const keyTags = pickKeyDecisionTags(item.health.tags, 4);
        const missingRecipe = item.health.tags.some((tag) => tag.key === "MISSING_RECIPE");
        const missingCost = item.health.tags.some((tag) => tag.key === "MISSING_COST_DATA");

        return (
          <div
            key={item.skuId}
            className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-zinc-900">{item.skuName}</p>
                <p className="text-xs text-zinc-500">
                  售价 {formatCurrency(item.price)}
                </p>
              </div>
              <ProductDecisionHealthBadge
                status={item.health.status}
                statusLabel={item.health.statusLabel}
              />
            </div>

            <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
              <p>
                标准毛利率{" "}
                {formatNullable(item.marginEstimates.standard, (value) =>
                  formatPercent(value)
                )}
              </p>
              <p>
                保守毛利率{" "}
                {formatNullable(item.marginEstimates.conservative, (value) =>
                  formatPercent(value)
                )}
              </p>
              <p>
                建议售价（60%）{" "}
                {suggestedPrice ? formatCurrency(suggestedPrice) : "—"}
              </p>
              <p>
                近期订单 {formatNumber(item.sales.orderCount)} 笔
              </p>
            </div>

            {missingRecipe ? (
              <p className="mt-2 text-xs text-amber-800">
                该 SKU 未绑定配方，无法生成完整产品决策。请先绑定 WMS Recipe。
              </p>
            ) : null}
            {missingCost ? (
              <p className="mt-2 text-xs text-amber-800">
                部分花材缺少标准成本或可用率，产品决策结果可能不完整。
              </p>
            ) : null}

            {item.health.reasons.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-zinc-600">
                {item.health.reasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3">
              <ProductDecisionTags tags={keyTags} />
            </div>
          </div>
        );
      })}
      <Link
        href={`/wms/reports?tab=product-decisions&productId=${productId}`}
        className="inline-flex text-sm text-rose-600 hover:underline"
      >
        在产品决策中心查看完整分析 →
      </Link>
    </div>
  );

  if (!compact) {
    return content;
  }

  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded((event.target as HTMLDetailsElement).open)}
      className="rounded-xl border border-zinc-200 bg-white"
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-900">
        查看产品决策建议
      </summary>
      <div className="border-t border-zinc-100 px-4 py-4">{content}</div>
    </details>
  );
}
