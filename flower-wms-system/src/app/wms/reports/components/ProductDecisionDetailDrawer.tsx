"use client";

import Link from "next/link";
import { ProductDecisionHealthBadge } from "@/components/product-decision/ProductDecisionBadge";
import { ProductDecisionTags } from "@/components/product-decision/ProductDecisionTags";
import { formatNullable, formatNumber, formatSignedPercent } from "@/lib/format-display";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import {
  getLossSensitivityLabel,
  getSuggestedPriceAtTarget,
} from "@/lib/product-decision-tags";
import type { ProductDecisionItem } from "@/lib/product-decision-types";
import { Section } from "./report-ui";

function sensitivityHint(level: string) {
  if (level === "LOW") {
    return "该产品对损耗不敏感，适合作为稳定主推款。";
  }
  if (level === "HIGH") {
    return "该产品在保守模式下毛利下降明显，建议谨慎备货或优化配方。";
  }
  if (level === "MEDIUM") {
    return "该产品对花材损耗有一定敏感度，定价和备货需预留缓冲。";
  }
  return "损耗敏感度数据不足，建议完善配方与花材可用率后再判断。";
}

export function ProductDecisionDetailDrawer({
  item,
  targetMargin,
  onClose,
}: {
  item: ProductDecisionItem | null;
  targetMargin: number;
  onClose: () => void;
}) {
  if (!item) return null;

  const marginRows = [
    {
      mode: "原始预估",
      cost: item.costStructure.materialCost,
      extra: "—",
      margin: item.marginEstimates.raw,
    },
    {
      mode: "乐观",
      cost: item.costStructure.totalCost,
      extra: "—",
      margin: item.marginEstimates.optimistic,
    },
    {
      mode: "标准",
      cost: item.costStructure.totalCost,
      extra: item.costStructure.lossModelExtraCost,
      margin: item.marginEstimates.standard,
    },
    {
      mode: "保守",
      cost: item.costStructure.totalCost,
      extra: item.costStructure.lossModelExtraCost,
      margin: item.marginEstimates.conservative,
    },
  ];

  const uniqueSuggested = item.suggestedPrices.filter(
    (price, index, list) =>
      list.findIndex(
        (candidate) =>
          candidate.targetMargin === price.targetMargin &&
          candidate.basedOnMode === price.basedOnMode
      ) === index
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-200 px-6 py-4">
          <div>
            <p className="text-xs text-zinc-500">{item.productName}</p>
            <h3 className="text-lg font-semibold text-zinc-900">{item.skuName}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ProductDecisionHealthBadge
                status={item.health.status}
                statusLabel={item.health.statusLabel}
              />
              <span className="text-xs text-zinc-500">
                {item.isActive ? "已上架" : "未上架"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            关闭
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <Section title="基本信息">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p>分类：{item.categoryName || "—"}</p>
              <p>当前售价：{formatCurrency(item.price)}</p>
              <p>
                绑定配方：
                {item.health.tags.some((tag) => tag.key === "MISSING_RECIPE")
                  ? "未绑定"
                  : "已绑定"}
              </p>
            </div>
            {item.health.warnings.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-amber-800">
                {item.health.warnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            ) : null}
          </Section>

          <Section title="销售表现">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p>销售额：{formatCurrency(item.sales.salesAmount)}</p>
              <p>订单数：{formatNumber(item.sales.orderCount)}</p>
              <p>销售数量：{formatNumber(item.sales.quantitySold)}</p>
              <p>平均售价：{formatCurrency(item.sales.averageSellingPrice)}</p>
            </div>
            {item.actualPerformance.hasActualData ? (
              <p className="mt-3 text-sm text-zinc-600">
                实际毛利率{" "}
                {formatNullable(item.actualPerformance.actualGrossMargin, (value) =>
                  formatPercent(value)
                )}
              </p>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">
                当前 SKU 实际毛利数据不足，系统基于产品配方和损耗模型给出预估判断。
              </p>
            )}
          </Section>

          <Section
            title="三档毛利模拟"
            description="乐观 / 标准 / 保守模式基于花材可用率模型，用于判断产品是否抗损耗。"
          >
            <div className="overflow-x-auto rounded-lg border border-zinc-100">
              <table className="w-full min-w-max text-left text-sm">
                <thead className="bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-3 py-2">模式</th>
                    <th className="px-3 py-2 text-right">估算成本</th>
                    <th className="px-3 py-2 text-right">毛利率</th>
                    <th className="px-3 py-2 text-right">损耗增加成本</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {marginRows.map((row) => (
                    <tr key={row.mode}>
                      <td className="px-3 py-2">{row.mode}</td>
                      <td className="px-3 py-2 text-right">
                        {row.mode === "原始预估"
                          ? formatCurrency(item.costStructure.materialCost)
                          : formatCurrency(item.costStructure.totalCost)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatNullable(row.margin, (value) => formatPercent(value))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.extra === "—" ? "—" : formatCurrency(row.extra)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="损耗敏感度">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                标准到保守下降：{" "}
                {formatSignedPercent(item.lossSensitivity.marginDropFromStandardToConservative)}
              </p>
              <p>
                总下降幅度：{" "}
                {formatSignedPercent(item.lossSensitivity.totalMarginDrop)}
              </p>
              <p>
                敏感度等级：{getLossSensitivityLabel(item.lossSensitivity.level)}
              </p>
            </div>
            <p className="mt-3 text-sm text-zinc-600">
              {sensitivityHint(item.lossSensitivity.level)}
            </p>
          </Section>

          <Section
            title="建议售价"
            description="建议售价仅用于定价参考，仍需结合市场价格带、品牌定位和顾客心理预算。"
          >
            <div className="overflow-x-auto rounded-lg border border-zinc-100">
              <table className="w-full min-w-max text-left text-sm">
                <thead className="bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-3 py-2">目标毛利率</th>
                    <th className="px-3 py-2 text-right">建议售价</th>
                    <th className="px-3 py-2">基于模式</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {uniqueSuggested.map((price) => (
                    <tr key={`${price.targetMargin}-${price.basedOnMode}`}>
                      <td className="px-3 py-2">
                        {formatPercent(price.targetMargin)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatCurrency(price.roundedSuggestedPrice)}
                      </td>
                      <td className="px-3 py-2">
                        {price.basedOnMode === "CONSERVATIVE" ? "保守" : "标准"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              目标 {formatPercent(targetMargin)} 建议价：{" "}
              {formatNullable(
                getSuggestedPriceAtTarget(item.suggestedPrices, targetMargin),
                formatCurrency
              )}
            </p>
          </Section>

          <Section title="成本结构">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>花材成本：{formatCurrency(item.costStructure.materialCost)}</p>
              <p>包装成本：{formatCurrency(item.costStructure.packagingCost)}</p>
              <p>总成本：{formatCurrency(item.costStructure.totalCost)}</p>
              <p>
                花材占比：{" "}
                {formatNullable(item.costStructure.materialCostRatio, (value) =>
                  formatPercent(value)
                )}
              </p>
              <p>
                包装占比：{" "}
                {formatNullable(item.costStructure.packagingCostRatio, (value) =>
                  formatPercent(value)
                )}
              </p>
              <p>
                损耗增加成本：{formatCurrency(item.costStructure.lossModelExtraCost)}
              </p>
              <p>
                损耗增加占比：{" "}
                {formatNullable(item.costStructure.lossExtraCostRatio, (value) =>
                  formatPercent(value)
                )}
              </p>
            </div>
            <div className="mt-3">
              <ProductDecisionTags
                tags={item.health.tags.filter((tag) =>
                  ["PACKAGING_COST_RISK", "COST_STRUCTURE_RISK", "HIGH_LOSS_SENSITIVITY"].includes(
                    tag.key
                  )
                )}
              />
            </div>
          </Section>

          <Section title="决策标签与原因">
            <div className="space-y-3">
              {item.health.tags.map((tag) => (
                <div key={tag.key} className="rounded-lg border border-zinc-100 p-3">
                  <ProductDecisionTags tags={[tag]} />
                  {tag.reason ? (
                    <p className="mt-2 text-sm text-zinc-600">{tag.reason}</p>
                  ) : null}
                </div>
              ))}
              {item.health.reasons.map((reason) => (
                <p key={reason} className="text-sm text-zinc-600">
                  • {reason}
                </p>
              ))}
            </div>
          </Section>
        </div>

        <div className="border-t border-zinc-200 px-6 py-4">
          <Link
            href={`/cms/products/${item.productId}`}
            className="text-sm text-rose-600 hover:underline"
          >
            前往商品编辑 →
          </Link>
        </div>
      </div>
    </div>
  );
}
