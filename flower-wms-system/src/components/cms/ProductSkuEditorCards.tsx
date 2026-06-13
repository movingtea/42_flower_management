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
import { isSingleSpecProduct } from "@/lib/cms/single-spec-product";
import { formatPercent } from "@/lib/format-money";
import { SkuLossSimulationDrawer } from "@/components/cms/SkuLossSimulationDrawer";
import type { ProductMarginEstimate, SkuMarginEstimate } from "@/services/product-margin";

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

function getSkuStatusAreaHint(
  row: ProductSkuEditorRow,
  cmsBadge: ReturnType<typeof getCmsSkuEditorBadge>
): string | null {
  if (row.isActive === false) {
    return "该规格已停用，即使有库存也不会在小程序售卖";
  }
  if (cmsBadge.status === "sold_out" && row.id) {
    return "小程序前台将显示售罄";
  }
  return null;
}

function SkuStatusControl({
  row,
  cmsBadge,
  onToggleActive,
}: {
  row: ProductSkuEditorRow;
  cmsBadge: ReturnType<typeof getCmsSkuEditorBadge>;
  onToggleActive: (checked: boolean) => void;
}) {
  const hint = getSkuStatusAreaHint(row, cmsBadge);

  return (
    <div className="flex min-w-[240px] shrink-0 flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-3">
        <span
          className={`inline-flex min-w-[4.5rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${skuStatusBadgeClassName(cmsBadge.status)}`}
        >
          {cmsBadge.label}
        </span>
        <Switch
          label="启用"
          checked={row.isActive !== false}
          onChange={onToggleActive}
        />
      </div>
      <p className="min-h-[2.5rem] max-w-[15rem] text-right text-[11px] leading-snug text-zinc-500">
        {hint ?? "\u00A0"}
      </p>
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
  const [lossDrawerIndex, setLossDrawerIndex] = useState<number | null>(null);
  const singleSpec = isSingleSpecProduct(skus.length);

  const lossDrawerRow =
    lossDrawerIndex != null ? skus[lossDrawerIndex] : null;
  const lossDrawerEstimate = lossDrawerRow
    ? findSkuEstimate(lossDrawerRow, marginEstimate)
    : null;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            {singleSpec ? "价格与库存" : "款式列表（SKU / 主图）"}
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            {singleSpec
              ? "单规格商品可直接填写售价与库存；如需多个款式，请点击「添加款式」"
              : "指定一个「商品卡片主图」用于小程序列表封面"}
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
          const canExpandLoss = Boolean(estimate && estimate.recipeId === row.recipeId);
          const cardTitle = singleSpec
            ? "单规格"
            : `款式 ${index + 1}`;

          return (
            <article
              key={rowKey}
              className="rounded-xl border border-zinc-200 bg-zinc-50/30 p-4 shadow-sm"
            >
              <header className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-3">
                <div className="min-w-0 flex-1 space-y-2">
                  {singleSpec ? (
                    <div>
                      <p className="text-sm font-semibold text-zinc-900">
                        {cardTitle}
                      </p>
                      <p className="text-xs text-zinc-500">
                        默认规格 · 小程序不展示款式选择
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-zinc-500">
                        {cardTitle}
                      </p>
                      <input
                        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium"
                        value={row.specName}
                        onChange={(e) =>
                          onUpdateRow(index, { specName: e.target.value })
                        }
                        placeholder="款式品名，如：大号 / 标准款"
                      />
                    </>
                  )}
                  {row.skuCode ? (
                    <p className="text-xs text-zinc-400">编码：{row.skuCode}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-start gap-2">
                  <SkuStatusControl
                    row={row}
                    cmsBadge={cmsBadge}
                    onToggleActive={(checked) =>
                      onUpdateRow(index, { isActive: checked })
                    }
                  />
                  {!singleSpec ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-0.5 text-red-600 hover:text-red-800"
                      disabled={skus.length <= 1}
                      onClick={() => onRemoveRow(index)}
                    >
                      删除
                    </Button>
                  ) : null}
                </div>
              </header>

              <div className="mt-4 grid gap-4 lg:grid-cols-[9rem_minmax(0,1fr)_minmax(0,14rem)]">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-600">
                    {singleSpec ? "商品图" : "款式图"}
                  </p>
                  <div className="relative mx-auto h-28 w-28 overflow-hidden rounded-lg border border-zinc-200 bg-white lg:mx-0">
                    <CmsImagePreview
                      stored={row.imageUrl}
                      alt={singleSpec ? "商品图" : "款式图"}
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

              <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
                {canExpandLoss ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setLossDrawerIndex(index)}
                  >
                    查看损耗模拟
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

            </article>
          );
        })}
      </div>

      {lossDrawerRow && lossDrawerEstimate ? (
        <SkuLossSimulationDrawer
          open={lossDrawerIndex != null}
          onOpenChange={(open) => {
            if (!open) setLossDrawerIndex(null);
          }}
          skuLabel={
            singleSpec
              ? "单规格"
              : lossDrawerRow.specName || `款式 ${(lossDrawerIndex ?? 0) + 1}`
          }
          price={lossDrawerRow.price}
          stock={lossDrawerRow.stock}
          estimate={lossDrawerEstimate}
          onApplySuggestedPrice={(price) => {
            if (lossDrawerIndex != null) {
              onUpdateRow(lossDrawerIndex, { price });
            }
          }}
        />
      ) : null}
    </section>
  );
}
