"use client";

import { useState } from "react";
import { formatPercent } from "@/lib/format-money";
import type {
  MarginEstimateSlice,
  SkuMarginEstimate,
} from "@/services/product-margin";

export function SkuLossSimulationContent({
  estimate,
}: {
  estimate: SkuMarginEstimate;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const rows: Array<{
    key: string;
    label: string;
    slice: MarginEstimateSlice;
    hint: string;
  }> = [
    {
      key: "optimistic",
      label: "乐观",
      slice: estimate.lossModelEstimates.optimistic,
      hint: "按花材乐观可用率估算",
    },
    {
      key: "standard",
      label: "标准",
      slice: estimate.lossModelEstimates.standard,
      hint: "按花材默认可用率估算",
    },
    {
      key: "conservative",
      label: "保守",
      slice: estimate.lossModelEstimates.conservative,
      hint: "用于判断产品抗不抗损耗",
    },
  ];

  const warningText = estimate.warnings.join("；");
  const rawMargin = Number(estimate.rawEstimate.estimatedGrossMargin);
  const standardMargin = Number(
    estimate.lossModelEstimates.standard.estimatedGrossMargin
  );

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-xs text-zinc-500">原始毛利率</p>
          <p className="font-semibold text-zinc-900">
            {formatPercent(rawMargin)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-xs text-zinc-500">标准损耗后毛利率</p>
          <p className="font-semibold text-zinc-900">
            {formatPercent(standardMargin)}
          </p>
        </div>
      </div>

      <p className="text-xs text-zinc-600">
        花材 ¥{estimate.rawEstimate.materialCost} · 包装 ¥
        {estimate.rawEstimate.packagingCost} · 毛利 ¥
        {estimate.rawEstimate.estimatedGrossProfit}
      </p>

      <p className="text-xs text-zinc-600">
        建议售价：
        {estimate.suggestedPrices.length > 0
          ? estimate.suggestedPrices
              .map(
                (item) =>
                  `${(Number(item.targetMargin) * 100).toFixed(0)}% ¥${item.price}`
              )
              .join(" / ")
          : "—"}
      </p>

      {warningText ? (
        <p className="text-xs text-amber-800">⚠ {warningText}</p>
      ) : (
        <p className="text-xs text-emerald-700">
          {estimate.rawEstimate.marginLevel}
        </p>
      )}

      <button
        type="button"
        className="text-xs font-medium text-rose-600 hover:underline"
        onClick={() => setDetailsOpen((v) => !v)}
      >
        {detailsOpen ? "收起详细计算" : "展开详细计算"}
      </button>

      {detailsOpen ? (
        <div className="rounded-lg border border-sky-100 bg-sky-50/50 p-3 text-xs">
          <p className="mb-2 text-[11px] text-sky-800">
            原始预估：不计入损耗模型；标准模式：按花材默认可用率估算。
          </p>
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-sky-900">
                <th className="py-1 pr-2 font-medium">模式</th>
                <th className="py-1 pr-2 text-right font-medium">估算成本</th>
                <th className="py-1 pr-2 text-right font-medium">毛利</th>
                <th className="py-1 text-right font-medium">毛利率</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-sky-100 text-zinc-700">
                <td className="py-1 pr-2">原始</td>
                <td className="py-1 pr-2 text-right">
                  ¥{estimate.rawEstimate.totalCost}
                </td>
                <td className="py-1 pr-2 text-right">
                  ¥{estimate.rawEstimate.estimatedGrossProfit}
                </td>
                <td className="py-1 text-right">
                  {formatPercent(estimate.rawEstimate.estimatedGrossMargin)}
                </td>
              </tr>
              {rows.map((item) => (
                <tr
                  key={item.key}
                  className="border-t border-sky-100 text-zinc-700"
                >
                  <td className="py-1 pr-2" title={item.hint}>
                    {item.label}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    ¥{item.slice.totalCost}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    ¥{item.slice.estimatedGrossProfit}
                  </td>
                  <td className="py-1 text-right">
                    {formatPercent(item.slice.estimatedGrossMargin)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
