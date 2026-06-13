"use client";

import { useState } from "react";
import type { ProductSkuEditorRow } from "@/app/cms/products/types";
import { RecipeSelect } from "@/components/cms/RecipeSelect";
import { CmsImagePreview } from "@/components/cms/CmsImagePreview";
import { Button } from "@/components/ui/button";
import { DecimalStringInput, NumberInput } from "@/components/ui/NumberInput";
import { Switch } from "@/components/ui/Switch";
import {
  getCmsSkuEditorBadge,
  skuStatusBadgeClassName,
} from "@/lib/cms/sku-display";
import { formatPercent } from "@/lib/format-money";
import type {
  MarginEstimateSlice,
  ProductMarginEstimate,
  SkuMarginEstimate,
} from "@/services/product-margin";

type Props = {
  skus: ProductSkuEditorRow[];
  marginEstimate: ProductMarginEstimate | null;
  marginLoading: boolean;
  marginError: string;
  uploadingIndex: number | null;
  submitting: boolean;
  onAddRow: () => void;
  onUpdateRow: (index: number, patch: Partial<ProductSkuEditorRow>) => void;
  onRemoveRow: (index: number) => void;
  onSetMainImage: (index: number) => void;
  onPickImage: (index: number) => void;
};

function findSkuEstimate(
  row: ProductSkuEditorRow,
  marginEstimate: ProductMarginEstimate | null
): SkuMarginEstimate | null {
  if (!row.id || !marginEstimate) return null;
  return marginEstimate.skus.find((e) => e.skuId === row.id) ?? null;
}

function SkuMarginSummary({
  row,
  estimate,
  marginLoading,
}: {
  row: ProductSkuEditorRow;
  estimate: SkuMarginEstimate | null;
  marginLoading: boolean;
}) {
  if (!row.id) {
    return <p className="text-xs text-zinc-400">保存后计算毛利预估</p>;
  }
  if (marginLoading) {
    return <p className="text-xs text-zinc-400">计算中…</p>;
  }
  if (!estimate) {
    return <p className="text-xs text-zinc-400">暂无毛利预估</p>;
  }
  if (estimate.recipeId !== row.recipeId) {
    return (
      <p className="text-xs text-amber-700">配方已修改，保存后刷新预估</p>
    );
  }
  if (!estimate.recipeId) {
    return (
      <p className="text-xs text-zinc-500">未绑定配方，无法计算毛利预估</p>
    );
  }

  const margin = Number(estimate.rawEstimate.estimatedGrossMargin);
  const standardMargin = Number(
    estimate.lossModelEstimates.standard.estimatedGrossMargin
  );

  return (
    <dl className="space-y-1 text-xs text-zinc-700">
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
        <dt className="text-zinc-500">原始成本</dt>
        <dd className="font-medium">¥{estimate.rawEstimate.totalCost}</dd>
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
        <dt className="text-zinc-500">原始毛利率</dt>
        <dd
          className={`font-medium ${
            margin < 0.45
              ? "text-amber-800"
              : margin > 0.7
                ? "text-violet-800"
                : "text-emerald-800"
          }`}
        >
          {formatPercent(margin)}
        </dd>
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
        <dt className="text-zinc-500">标准损耗后毛利率</dt>
        <dd className="font-medium">{formatPercent(standardMargin)}</dd>
      </div>
    </dl>
  );
}

function SkuLossSimulationPanel({ estimate }: { estimate: SkuMarginEstimate }) {
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

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-sky-100 bg-sky-50/50 p-3 text-xs">
      <p className="text-sky-900">
        花材 ¥{estimate.rawEstimate.materialCost} · 包装 ¥
        {estimate.rawEstimate.packagingCost} · 毛利 ¥
        {estimate.rawEstimate.estimatedGrossProfit}
      </p>
      <p className="text-zinc-600">
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
        <p className="text-amber-800">⚠ {warningText}</p>
      ) : (
        <p className="text-emerald-700">{estimate.rawEstimate.marginLevel}</p>
      )}
      <p className="text-[11px] text-sky-800">
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
            <tr key={item.key} className="border-t border-sky-100 text-zinc-700">
              <td className="py-1 pr-2" title={item.hint}>
                {item.label}
              </td>
              <td className="py-1 pr-2 text-right">¥{item.slice.totalCost}</td>
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
  );
}

export function ProductSkuEditorCards({
  skus,
  marginEstimate,
  marginLoading,
  marginError,
  uploadingIndex,
  submitting,
  onAddRow,
  onUpdateRow,
  onRemoveRow,
  onSetMainImage,
  onPickImage,
}: Props) {
  const [expandedLoss, setExpandedLoss] = useState<Record<string, boolean>>({});

  function toggleLoss(key: string) {
    setExpandedLoss((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            款式列表（SKU / 主图）
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            指定一个「商品卡片主图」用于小程序列表封面
          </p>
          {marginError ? (
            <p className="mt-1 text-xs text-amber-700">{marginError}</p>
          ) : null}
        </div>
        <Button type="button" variant="secondary" onClick={onAddRow}>
          + 添加款式
        </Button>
      </div>

      <div className="space-y-4">
        {skus.map((row, index) => {
          const rowKey = row.id ?? `new-${index}`;
          const cmsBadge = getCmsSkuEditorBadge({
            id: row.id,
            isActive: row.isActive,
            stock: row.stock,
          });
          const estimate = findSkuEstimate(row, marginEstimate);
          const lossExpanded = Boolean(expandedLoss[rowKey]);
          const canExpandLoss = Boolean(estimate && estimate.recipeId === row.recipeId);

          return (
            <article
              key={rowKey}
              className="rounded-xl border border-zinc-200 bg-zinc-50/30 p-4 shadow-sm"
            >
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 pb-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    className="w-full max-w-md rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium"
                    value={row.specName}
                    onChange={(e) =>
                      onUpdateRow(index, { specName: e.target.value })
                    }
                    placeholder="款式品名，如：标准款"
                  />
                  {row.skuCode ? (
                    <p className="text-xs text-zinc-400">编码：{row.skuCode}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="space-y-0.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${skuStatusBadgeClassName(cmsBadge.status)}`}
                    >
                      {cmsBadge.label}
                    </span>
                    {cmsBadge.hint ? (
                      <p className="max-w-[12rem] text-[11px] text-zinc-500">
                        {cmsBadge.hint}
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    label="启用"
                    checked={row.isActive !== false}
                    onChange={(checked) =>
                      onUpdateRow(index, { isActive: checked })
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="text-red-600 hover:text-red-800"
                    disabled={skus.length <= 1}
                    onClick={() => onRemoveRow(index)}
                  >
                    删除
                  </Button>
                </div>
              </header>

              <div className="mt-4 grid gap-4 lg:grid-cols-[9rem_minmax(0,1fr)_minmax(0,14rem)]">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-600">款式图</p>
                  <div className="relative mx-auto h-28 w-28 overflow-hidden rounded-lg border border-zinc-200 bg-white lg:mx-0">
                    <CmsImagePreview
                      stored={row.imageUrl}
                      alt="款式图"
                      fill
                      compact
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={uploadingIndex === index}
                    onClick={() => onPickImage(index)}
                  >
                    {uploadingIndex === index ? "上传中…" : "上传图片"}
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600">
                      大仓配方
                    </label>
                    <RecipeSelect
                      value={row.recipeId}
                      onChange={(recipeId) => onUpdateRow(index, { recipeId })}
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <DecimalStringInput
                      label="价格（元）"
                      value={row.price}
                      onChange={(price) => onUpdateRow(index, { price })}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <NumberInput
                      label="库存"
                      integerOnly
                      min={0}
                      allowEmpty
                      value={row.stock}
                      onChange={(stock) => onUpdateRow(index, { stock })}
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm">
                      <input
                        type="radio"
                        name="mainImageSku"
                        checked={row.isMainImage}
                        onChange={() => onSetMainImage(index)}
                        className="accent-rose-600"
                      />
                      商品卡片主图
                    </label>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-200 bg-white p-3">
                  <p className="mb-2 text-xs font-semibold text-zinc-800">
                    毛利摘要
                  </p>
                  <SkuMarginSummary
                    row={row}
                    estimate={estimate}
                    marginLoading={marginLoading}
                  />
                </div>
              </div>

              <p className="mt-3 text-xs text-zinc-500">
                关闭后，该规格不会在小程序展示，也不能被加入购物车或下单。
              </p>

              <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
                {canExpandLoss ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => toggleLoss(rowKey)}
                  >
                    {lossExpanded ? "收起损耗模拟" : "查看损耗模拟"}
                  </Button>
                ) : null}
                {!row.isMainImage ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onSetMainImage(index)}
                  >
                    设为主图
                  </Button>
                ) : (
                  <span className="text-xs font-medium text-rose-700">
                    当前为主图
                  </span>
                )}
              </footer>

              {lossExpanded && estimate ? (
                <SkuLossSimulationPanel estimate={estimate} />
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
