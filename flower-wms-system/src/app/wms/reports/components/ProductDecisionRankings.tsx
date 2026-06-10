"use client";

import { ProductDecisionTags } from "@/components/product-decision/ProductDecisionTags";
import { formatNullable, formatSignedPercent } from "@/lib/format-display";
import { formatCurrency, formatPercent, safeDecimalToNumber } from "@/lib/format-money";
import {
  getSuggestedPriceAtTarget,
  pickKeyDecisionTags,
} from "@/lib/product-decision-tags";
import type { ProductDecisionItem } from "@/lib/product-decision-types";
import { EmptyRow, Section, TableShell } from "./report-ui";

function ProductSkuCell({ item }: { item: ProductDecisionItem }) {
  return (
    <div>
      <p className="font-medium text-zinc-900">{item.productName}</p>
      <p className="text-xs text-zinc-500">{item.skuName}</p>
    </div>
  );
}

export function ProductDecisionRankings({
  rankings,
  targetMargin,
}: {
  rankings: {
    recommendedProducts: ProductDecisionItem[];
    lowMarginProducts: ProductDecisionItem[];
    highLossSensitivityProducts: ProductDecisionItem[];
    priceIncreaseSuggestedProducts: ProductDecisionItem[];
    incompleteDataProducts: ProductDecisionItem[];
  };
  targetMargin: number;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Section title="推荐主推产品">
        <TableShell>
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">产品 / SKU</th>
              <th className="px-3 py-2 text-right">售价</th>
              <th className="px-3 py-2 text-right">标准毛利率</th>
              <th className="px-3 py-2 text-right">销售额</th>
              <th className="px-3 py-2">标签</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rankings.recommendedProducts.length === 0 ? (
              <EmptyRow colSpan={5} text="暂无推荐主推产品。" />
            ) : (
              rankings.recommendedProducts.map((item) => (
                <tr key={item.skuId}>
                  <td className="px-3 py-2">
                    <ProductSkuCell item={item} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(item.price)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatNullable(item.marginEstimates.standard, (value) =>
                      formatPercent(value)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(item.sales.salesAmount)}
                  </td>
                  <td className="px-3 py-2">
                    <ProductDecisionTags tags={pickKeyDecisionTags(item.health.tags, 2)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableShell>
      </Section>

      <Section title="低毛利产品">
        <TableShell>
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">产品 / SKU</th>
              <th className="px-3 py-2 text-right">售价</th>
              <th className="px-3 py-2 text-right">标准毛利率</th>
              <th className="px-3 py-2 text-right">建议售价</th>
              <th className="px-3 py-2">原因</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rankings.lowMarginProducts.length === 0 ? (
              <EmptyRow colSpan={5} text="暂无低毛利产品。" />
            ) : (
              rankings.lowMarginProducts.map((item) => (
                <tr key={item.skuId}>
                  <td className="px-3 py-2">
                    <ProductSkuCell item={item} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatCurrency(item.price)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatNullable(item.marginEstimates.standard, (value) =>
                      formatPercent(value)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatNullable(
                      getSuggestedPriceAtTarget(item.suggestedPrices, targetMargin),
                      formatCurrency
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-600">
                    {item.health.reasons[0] || item.health.tags[0]?.reason || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableShell>
      </Section>

      <Section title="损耗敏感产品">
        <TableShell>
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">产品 / SKU</th>
              <th className="px-3 py-2 text-right">总毛利率下降</th>
              <th className="px-3 py-2 text-right">标准到保守下降</th>
              <th className="px-3 py-2">标签</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rankings.highLossSensitivityProducts.length === 0 ? (
              <EmptyRow colSpan={4} text="暂无损耗敏感产品。" />
            ) : (
              rankings.highLossSensitivityProducts.map((item) => (
                <tr key={item.skuId}>
                  <td className="px-3 py-2">
                    <ProductSkuCell item={item} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatSignedPercent(item.lossSensitivity.totalMarginDrop)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatSignedPercent(
                      item.lossSensitivity.marginDropFromStandardToConservative
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ProductDecisionTags tags={pickKeyDecisionTags(item.health.tags, 2)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableShell>
      </Section>

      <Section title="建议调价产品">
        <TableShell>
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">产品 / SKU</th>
              <th className="px-3 py-2 text-right">当前售价</th>
              <th className="px-3 py-2 text-right">建议售价</th>
              <th className="px-3 py-2 text-right">差额</th>
              <th className="px-3 py-2">原因</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rankings.priceIncreaseSuggestedProducts.length === 0 ? (
              <EmptyRow colSpan={5} text="暂无建议调价产品。" />
            ) : (
              rankings.priceIncreaseSuggestedProducts.map((item) => {
                const suggested = getSuggestedPriceAtTarget(
                  item.suggestedPrices,
                  targetMargin
                );
                const gap =
                  suggested !== null
                    ? safeDecimalToNumber(suggested) - safeDecimalToNumber(item.price)
                    : null;
                return (
                  <tr key={item.skuId}>
                    <td className="px-3 py-2">
                      <ProductSkuCell item={item} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(item.price)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {suggested ? formatCurrency(suggested) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {gap !== null ? formatCurrency(gap) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-600">
                      {item.health.tags.find((tag) => tag.key === "PRICE_INCREASE_SUGGESTED")
                        ?.reason || "当前售价低于目标毛利率建议价。"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableShell>
      </Section>

      <Section title="数据不完整产品" description="优先处理未绑定配方或缺少标准成本的产品。">
        <TableShell>
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-3 py-2">产品 / SKU</th>
              <th className="px-3 py-2">缺失项</th>
              <th className="px-3 py-2">建议动作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rankings.incompleteDataProducts.length === 0 ? (
              <EmptyRow colSpan={3} text="暂无数据不完整产品。" />
            ) : (
              rankings.incompleteDataProducts.map((item) => {
                const missingTags = item.health.tags.filter((tag) =>
                  ["MISSING_RECIPE", "MISSING_COST_DATA", "DATA_INSUFFICIENT"].includes(
                    tag.key
                  )
                );
                return (
                  <tr key={item.skuId}>
                    <td className="px-3 py-2">
                      <ProductSkuCell item={item} />
                    </td>
                    <td className="px-3 py-2">
                      <ProductDecisionTags tags={missingTags} />
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-600">
                      {item.health.tags.some((tag) => tag.key === "MISSING_RECIPE")
                        ? "请先绑定 WMS Recipe。"
                        : "请完善花材标准成本与可用率。"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableShell>
      </Section>
    </div>
  );
}
