"use client";

import Link from "next/link";
import { ProductDecisionHealthBadge } from "@/components/product-decision/ProductDecisionBadge";
import { ProductDecisionTags } from "@/components/product-decision/ProductDecisionTags";
import { formatNullable, formatNumber } from "@/lib/format-display";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import {
  getLossSensitivityLabel,
  getSuggestedPriceAtTarget,
  pickKeyDecisionTags,
} from "@/lib/product-decision-tags";
import type { ProductDecisionItem } from "@/lib/product-decision-types";
import { EmptyRow, TableShell } from "./report-ui";

export function ProductDecisionTable({
  products,
  targetMargin,
  onViewDetail,
}: {
  products: ProductDecisionItem[];
  targetMargin: number;
  onViewDetail: (item: ProductDecisionItem) => void;
}) {
  return (
    <TableShell>
      <thead className="bg-zinc-50 text-zinc-600">
        <tr>
          <th className="px-4 py-3 font-medium">产品 / SKU</th>
          <th className="px-4 py-3 font-medium">分类</th>
          <th className="px-4 py-3 font-medium text-right">当前售价</th>
          <th className="px-4 py-3 font-medium text-right">销售额</th>
          <th className="px-4 py-3 font-medium text-right">订单数</th>
          <th className="px-4 py-3 font-medium text-right">销售数量</th>
          <th className="px-4 py-3 font-medium text-right">标准毛利率</th>
          <th className="px-4 py-3 font-medium text-right">保守毛利率</th>
          <th className="px-4 py-3 font-medium">损耗敏感度</th>
          <th className="px-4 py-3 font-medium text-right">建议售价</th>
          <th className="px-4 py-3 font-medium">健康状态</th>
          <th className="px-4 py-3 font-medium">决策标签</th>
          <th className="px-4 py-3 font-medium">操作</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {products.length === 0 ? (
          <EmptyRow colSpan={13} text="暂无可分析的产品。" />
        ) : (
          products.map((item) => {
            const suggestedPrice = getSuggestedPriceAtTarget(
              item.suggestedPrices,
              targetMargin
            );
            return (
              <tr key={item.skuId} className="align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-900">{item.productName}</p>
                  <p className="text-xs text-zinc-500">{item.skuName}</p>
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {item.categoryName || "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatCurrency(item.price)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatCurrency(item.sales.salesAmount)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatNumber(item.sales.orderCount)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatNumber(item.sales.quantitySold)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatNullable(item.marginEstimates.standard, (value) =>
                    formatPercent(value)
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatNullable(item.marginEstimates.conservative, (value) =>
                    formatPercent(value)
                  )}
                </td>
                <td className="px-4 py-3">
                  {getLossSensitivityLabel(item.lossSensitivity.level)}
                </td>
                <td className="px-4 py-3 text-right">
                  {suggestedPrice ? formatCurrency(suggestedPrice) : "—"}
                </td>
                <td className="px-4 py-3">
                  <ProductDecisionHealthBadge
                    status={item.health.status}
                    statusLabel={item.health.statusLabel}
                  />
                </td>
                <td className="px-4 py-3">
                  <ProductDecisionTags
                    tags={pickKeyDecisionTags(item.health.tags, 3)}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1 text-sm">
                    <button
                      type="button"
                      onClick={() => onViewDetail(item)}
                      className="text-left text-rose-600 hover:underline"
                    >
                      查看详情
                    </button>
                    <Link
                      href={`/cms/products/${item.productId}`}
                      className="text-zinc-600 hover:underline"
                    >
                      商品编辑
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </TableShell>
  );
}
