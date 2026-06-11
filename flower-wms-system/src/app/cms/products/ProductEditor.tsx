"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { RecipeSelect } from "@/components/cms/RecipeSelect";
import { ProductCategoryTreeSelect } from "@/components/cms/ProductCategoryTreeSelect";
import { RichTextEditorLazy } from "@/components/cms/RichTextEditorLazy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/Switch";
import type {
  ProductEditorProps,
  ProductSkuEditorRow,
} from "@/app/cms/products/types";
import {
  ProductOperationTagsEditor,
  type ProductOperationTagsValue,
} from "@/components/cms/ProductOperationTagsEditor";
import { ProductMiniProgramPreview } from "@/components/cms/ProductMiniProgramPreview";
import { ProductPublishReadinessPanel } from "@/components/cms/ProductPublishReadinessPanel";
import { ProductDecisionPanel } from "@/components/product-decision/ProductDecisionPanel";
import { formatPercent } from "@/lib/format-money";
import type {
  MarginEstimateSlice,
  ProductMarginEstimate,
  SkuMarginEstimate,
} from "@/services/product-margin";

const SHIPPING_FEE_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
const SHIPPING_FEE_ERROR_MSG =
  "请输入正确的运费金额，最多支持两位小数";

type ProductMarginApiResponse = {
  success: boolean;
  data?: ProductMarginEstimate;
  error?: string;
};

function emptySkuRow(sortOrder = 0): ProductSkuEditorRow {
  return {
    specName: "",
    price: "",
    stock: 0,
    imageUrl: "",
    isMainImage: sortOrder === 0,
    isActive: true,
    sortOrder,
    recipeId: null,
    bulkPreorderEnabled: false,
    bulkOrderThreshold: "",
    bulkMinLeadDays: "",
    bulkPreorderMessage: "",
  };
}

function renderSkuStatusBadge(row: ProductSkuEditorRow): string | null {
  if (row.isActive === false) return "已停用";
  if (row.stock <= 0) return "卖光啦！";
  return null;
}

function formatBulkPreorderPreview(row: ProductSkuEditorRow): string | null {
  if (!row.bulkPreorderEnabled) return null;
  const threshold = Number(row.bulkOrderThreshold ?? "");
  const minLeadDays = Number(row.bulkMinLeadDays ?? "");
  if (
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    !Number.isInteger(minLeadDays) ||
    minLeadDays < 1
  ) {
    return "请填写有效的大批量阈值与最小提前天数。";
  }
  const dayLabel =
    minLeadDays === 1
      ? "明天"
      : minLeadDays === 2
        ? "后天"
        : `${minLeadDays} 天后`;
  return `购买 ${threshold} 件及以上时，最早可选择${dayLabel}配送。`;
}

export function ProductEditor({ productId, isNew, initial }: ProductEditorProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [marginLoading, setMarginLoading] = useState(false);
  const [marginEstimate, setMarginEstimate] =
    useState<ProductMarginEstimate | null>(null);
  const [marginError, setMarginError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const [name, setName] = useState(initial.name);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initial.category
  );
  const [operationTags, setOperationTags] = useState<ProductOperationTagsValue>({
    occasionTags: initial.occasionTags ?? [],
    colorTags: initial.colorTags ?? [],
    styleTags: initial.styleTags ?? [],
    relationshipTags: initial.relationshipTags ?? [],
    budgetTags: initial.budgetTags ?? [],
    positioningTags: initial.positioningTags ?? [],
    sellingPoints: initial.sellingPoints ?? [],
    operationNote: initial.operationNote ?? "",
  });
  const [readinessRefreshKey, setReadinessRefreshKey] = useState(0);
  const [isPublished, setIsPublished] = useState(initial.isActive);
  const [description, setDescription] = useState(initial.description);
  const [maintenanceGuideline, setMaintenanceGuideline] = useState(
    initial.maintenanceGuide
  );
  const [needsShipping, setNeedsShipping] = useState(initial.needsShipping);
  const [shippingFee, setShippingFee] = useState(initial.shippingFee);
  const [shippingFeeError, setShippingFeeError] = useState("");
  const [skus, setSkus] = useState<ProductSkuEditorRow[]>(
    initial.skus.length > 0 ? initial.skus : [emptySkuRow(0)]
  );

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2800);
  }

  const loadMarginEstimate = useCallback(async () => {
    if (isNew || productId === "new") return;
    setMarginLoading(true);
    setMarginError("");
    try {
      const res = await fetch(`/api/admin/products/${productId}/margin-estimate`);
      const json = (await res.json()) as ProductMarginApiResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "加载毛利预估失败");
      }
      setMarginEstimate(json.data);
    } catch (e) {
      setMarginError(e instanceof Error ? e.message : "加载毛利预估失败");
    } finally {
      setMarginLoading(false);
    }
  }, [isNew, productId]);

  useEffect(() => {
    void loadMarginEstimate();
  }, [loadMarginEstimate]);

  async function handleSkuImageUpload(file: File, index: number) {
    setUploadingIndex(index);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { url?: string; path?: string };
      };
      const url = json.data?.url ?? json.data?.path;
      if (!res.ok || !json.success || !url) {
        showToast(json.error ?? "上传失败，请稍后重试", "error");
        return;
      }
      setSkus((prev) =>
        prev.map((row, i) => (i === index ? { ...row, imageUrl: url } : row))
      );
      showToast("图片上传成功", "success");
    } catch {
      showToast("网络异常，请检查连接后重试", "error");
    } finally {
      setUploadingIndex(null);
    }
  }

  function addSkuRow() {
    setSkus((prev) => {
      const maxSort = prev.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
      return [...prev, emptySkuRow(maxSort + 10)];
    });
  }

  function removeSkuRow(index: number) {
    if (skus.length <= 1) {
      showToast("至少保留一个款式", "error");
      return;
    }
    setSkus((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (!next.some((r) => r.isMainImage)) {
        next[0].isMainImage = true;
      }
      return next;
    });
  }

  function updateSkuRow(
    index: number,
    patch: Partial<ProductSkuEditorRow>
  ) {
    setSkus((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  function setMainImage(index: number) {
    setSkus((prev) =>
      prev.map((row, i) => ({ ...row, isMainImage: i === index }))
    );
  }

  function validateShippingFeeInput(): boolean {
    if (!needsShipping) {
      setShippingFeeError("");
      return true;
    }
    const text = shippingFee.trim();
    if (!text || !SHIPPING_FEE_PATTERN.test(text)) {
      setShippingFeeError(SHIPPING_FEE_ERROR_MSG);
      return false;
    }
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount <= 0) {
      setShippingFeeError(SHIPPING_FEE_ERROR_MSG);
      return false;
    }
    setShippingFeeError("");
    return true;
  }

  function onNeedsShippingChange(checked: boolean) {
    setNeedsShipping(checked);
    setShippingFeeError("");
    if (!checked) setShippingFee("");
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!name.trim()) {
      showToast("请填写商品名称", "error");
      return;
    }
    if (selectedCategories.length === 0) {
      showToast("请至少选择一个商品分类", "error");
      return;
    }
    if (!validateShippingFeeInput()) return;

    for (let i = 0; i < skus.length; i++) {
      const row = skus[i];
      if (!row.specName.trim()) {
        showToast(`请填写第 ${i + 1} 行的款式品名`, "error");
        return;
      }
      const price = Number(row.price);
      if (!Number.isFinite(price) || price < 0) {
        showToast(`第 ${i + 1} 行价格无效`, "error");
        return;
      }
      if (!Number.isInteger(row.stock) || row.stock < 0) {
        showToast(`第 ${i + 1} 行库存须为非负整数`, "error");
        return;
      }
      if (row.bulkPreorderEnabled) {
        const threshold = Number(row.bulkOrderThreshold);
        const minLeadDays = Number(row.bulkMinLeadDays);
        if (!Number.isInteger(threshold) || threshold < 1) {
          showToast(
            `第 ${i + 1} 行已启用大批量提前预订，请填写有效阈值（≥1）`,
            "error"
          );
          return;
        }
        if (!Number.isInteger(minLeadDays) || minLeadDays < 1) {
          showToast(
            `第 ${i + 1} 行已启用大批量提前预订，请填写有效提前天数（≥1）`,
            "error"
          );
          return;
        }
      }
    }

    const payload = {
      name: name.trim(),
      category: selectedCategories,
      occasionTags: operationTags.occasionTags,
      colorTags: operationTags.colorTags,
      styleTags: operationTags.styleTags,
      relationshipTags: operationTags.relationshipTags,
      budgetTags: operationTags.budgetTags,
      positioningTags: operationTags.positioningTags,
      sellingPoints: operationTags.sellingPoints,
      operationNote: operationTags.operationNote.trim() || null,
      isActive: isPublished,
      needsShipping,
      shippingFee: needsShipping ? Number(shippingFee.trim()) : 0,
      description: description.trim() || null,
      maintenanceGuide: maintenanceGuideline.trim() || null,
      skus: skus.map((row, index) => ({
        id: row.id,
        skuCode: row.skuCode,
        specName: row.specName.trim(),
        price: Number(row.price),
        stock: row.stock,
        imageUrl: row.imageUrl.trim() || null,
        isMainImage: row.isMainImage,
        sortOrder: row.sortOrder ?? index * 10,
        recipeId: row.recipeId,
        bulkPreorderEnabled: row.bulkPreorderEnabled,
        bulkOrderThreshold: row.bulkOrderThreshold?.trim()
          ? Number(row.bulkOrderThreshold)
          : null,
        bulkMinLeadDays: row.bulkMinLeadDays?.trim()
          ? Number(row.bulkMinLeadDays)
          : null,
        bulkPreorderMessage: row.bulkPreorderMessage?.trim() || null,
      })),
    };

    setSubmitting(true);
    try {
      const url = isNew
        ? "/api/cms/products"
        : `/api/cms/products/${productId}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { message?: string; product?: { id: string } };
      };
      if (!res.ok || !json.success) {
        showToast(json.error ?? "保存失败，请稍后重试", "error");
        return;
      }
      showToast(json.data?.message ?? "保存成功", "success");

      if (isNew && json.data?.product?.id) {
        router.push(`/cms/products/${json.data.product.id}`);
        router.refresh();
        return;
      }

      await loadMarginEstimate();
      setReadinessRefreshKey((k) => k + 1);
      router.refresh();
    } catch {
      showToast("网络异常，请检查连接后重试", "error");
    } finally {
      setSubmitting(false);
    }
  }

  function findSkuEstimate(row: ProductSkuEditorRow): SkuMarginEstimate | null {
    if (!row.id) return null;
    return (
      marginEstimate?.skus.find((estimate) => estimate.skuId === row.id) ?? null
    );
  }

  function renderLossSimulationTable(estimate: SkuMarginEstimate) {
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

    return (
      <details className="mt-2 rounded-lg border border-sky-100 bg-sky-50/40 p-2">
        <summary className="cursor-pointer text-xs font-medium text-sky-900">
          查看损耗模拟
        </summary>
        <p className="mt-2 text-[11px] text-sky-800">
          原始预估：不计入损耗模型；标准模式：按花材默认可用率估算。
        </p>
        <table className="mt-2 w-full text-left text-[11px]">
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
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-sky-100 text-zinc-700">
                <td className="py-1 pr-2" title={row.hint}>
                  {row.label}
                </td>
                <td className="py-1 pr-2 text-right">¥{row.slice.totalCost}</td>
                <td className="py-1 pr-2 text-right">
                  ¥{row.slice.estimatedGrossProfit}
                </td>
                <td className="py-1 text-right">
                  {formatPercent(row.slice.estimatedGrossMargin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    );
  }

  function renderSkuMargin(row: ProductSkuEditorRow) {
    if (!row.id) {
      return <span className="text-xs text-zinc-400">保存后计算</span>;
    }
    if (marginLoading) {
      return <span className="text-xs text-zinc-400">计算中…</span>;
    }
    const estimate = findSkuEstimate(row);
    if (!estimate) {
      return <span className="text-xs text-zinc-400">暂无预估</span>;
    }
    if (estimate.recipeId !== row.recipeId) {
      return (
        <span className="text-xs text-amber-700">配方已修改，保存后刷新预估</span>
      );
    }

    const price = Number(row.price);
    const totalCost = Number(estimate.rawEstimate.totalCost);
    const profit = Number(estimate.rawEstimate.estimatedGrossProfit);
    const margin = Number(estimate.rawEstimate.estimatedGrossMargin);
    const warningText = estimate.warnings.join("；");

    return (
      <div className="min-w-48 space-y-1 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700">
            原始成本 ¥{estimate.rawEstimate.totalCost}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              margin < 0.45
                ? "bg-amber-100 text-amber-800"
                : margin > 0.7
                  ? "bg-violet-100 text-violet-800"
                  : "bg-emerald-100 text-emerald-800"
            }`}
          >
            原始毛利率 {formatPercent(margin)}
          </span>
        </div>
        <p className="text-zinc-600">
          花材 ¥{estimate.rawEstimate.materialCost} · 包装 ¥
          {estimate.rawEstimate.packagingCost} · 毛利 ¥{profit}
        </p>
        <p className="text-zinc-500">
          标准损耗后毛利率{" "}
          {formatPercent(
            estimate.lossModelEstimates.standard.estimatedGrossMargin
          )}
        </p>
        <p className="text-zinc-500">
          建议售价：
          {estimate.suggestedPrices
            .map((row) => `${(Number(row.targetMargin) * 100).toFixed(0)}% ¥${row.price}`)
            .join(" / ")}
        </p>
        {warningText ? (
          <p className="text-amber-700" title={warningText}>
            ⚠ {warningText}
          </p>
        ) : (
          <p className="text-emerald-700">{estimate.rawEstimate.marginLevel}</p>
        )}
        {renderLossSimulationTable(estimate)}
      </div>
    );
  }

  const sidebarMeta = (
    <>
      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-zinc-900">分类与预览</h3>
        <p className="text-xs text-zinc-500">
          列表最低价：¥{initial.displayMinPrice}
          {skus.length > 1 ? "起" : ""}
        </p>
        <ProductCategoryTreeSelect
          value={selectedCategories}
          onChange={setSelectedCategories}
        />
      </section>

      <section className="space-y-4 rounded-xl border border-rose-100 bg-white p-5 shadow-sm">
        <div className="rounded-lg border border-zinc-200 px-4 py-4">
          <Switch
            label="是否需要运费"
            checked={needsShipping}
            onChange={onNeedsShippingChange}
          />
          {needsShipping ? (
            <div className="mt-4">
              <Input
                label="运费金额（元）"
                type="text"
                inputMode="decimal"
                value={shippingFee}
                onChange={(e) => {
                  setShippingFee(e.target.value);
                  if (shippingFeeError) setShippingFeeError("");
                }}
              />
              {shippingFeeError ? (
                <p className="mt-2 text-sm text-red-600">{shippingFeeError}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-200 px-4 py-3">
          <span className="font-medium text-zinc-800">上架状态</span>
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
            className="h-5 w-5 accent-rose-600"
          />
        </label>
      </section>
    </>
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col pb-28"
    >
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">
            {isNew ? "新增商品" : "编辑商品"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            SPU 公用信息 + 多款式 SKU 管理
          </p>
        </div>
        <Link href="/cms/products" className="text-sm text-rose-600 hover:underline">
          返回商品列表
        </Link>
      </div>

      <div className="grid flex-1 grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900">SPU 基础信息</h3>
            <div className="mt-4">
              <Input
                label="商品名称（SPU）"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="请输入商品名称"
              />
            </div>
          </section>

          <RichTextEditorLazy
            label="商品描述"
            value={description}
            onChange={setDescription}
            placeholder="请输入商品描述，支持图文排版"
            minHeight={320}
          />
          <RichTextEditorLazy
            label="养护指南"
            value={maintenanceGuideline}
            onChange={setMaintenanceGuideline}
            placeholder="请输入养护指南，支持图文排版"
            minHeight={280}
          />

          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900">商品运营标签</h3>
            <div className="mt-4">
              <ProductOperationTagsEditor
                value={operationTags}
                onChange={setOperationTags}
              />
            </div>
          </section>

          {!isNew && productId !== "new" ? (
            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-zinc-900">上架校验</h3>
              <div className="mt-4">
                <ProductPublishReadinessPanel
                  productId={productId}
                  refreshKey={readinessRefreshKey}
                />
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
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
              <Button type="button" variant="secondary" onClick={addSkuRow}>
                + 添加款式
              </Button>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                const index = Number(fileRef.current?.dataset.index ?? -1);
                if (file && index >= 0) void handleSkuImageUpload(file, index);
                e.target.value = "";
              }}
            />

            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="border-b bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">款式品名</th>
                    <th className="px-3 py-2 font-medium">大仓配方</th>
                    <th className="px-3 py-2 font-medium">价格</th>
                    <th className="px-3 py-2 font-medium">毛利预估</th>
                    <th className="px-3 py-2 font-medium">库存</th>
                    <th className="px-3 py-2 font-medium">款式图</th>
                    <th className="px-3 py-2 font-medium">主图</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">启用</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {skus.map((row, index) => (
                    <tr key={row.id ?? `new-${index}`} className="align-top">
                      <td className="px-3 py-3">
                        <input
                          className="w-full rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={row.specName}
                          onChange={(e) =>
                            updateSkuRow(index, { specName: e.target.value })
                          }
                          placeholder="如：标准款"
                        />
                        {row.skuCode ? (
                          <p className="mt-1 text-xs text-zinc-400">
                            编码：{row.skuCode}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <RecipeSelect
                          value={row.recipeId}
                          onChange={(recipeId) =>
                            updateSkuRow(index, { recipeId })
                          }
                          disabled={submitting}
                          compact
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="w-24 rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={row.price}
                          onChange={(e) =>
                            updateSkuRow(index, { price: e.target.value })
                          }
                        />
                      </td>
                      <td className="px-3 py-3">{renderSkuMargin(row)}</td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="w-20 rounded-lg border border-zinc-200 px-2 py-1.5"
                          value={row.stock}
                          onChange={(e) =>
                            updateSkuRow(index, {
                              stock: Number(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          {row.imageUrl ? (
                            <div className="relative h-14 w-14 overflow-hidden rounded-lg border">
                              <Image
                                src={row.imageUrl}
                                alt="款式图"
                                fill
                                className="object-cover"
                                unoptimized
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-400">未上传</span>
                          )}
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={uploadingIndex === index}
                            onClick={() => {
                              if (fileRef.current) {
                                fileRef.current.dataset.index = String(index);
                                fileRef.current.click();
                              }
                            }}
                          >
                            {uploadingIndex === index ? "上传中…" : "上传"}
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <label className="inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="radio"
                            name="mainImageSku"
                            checked={row.isMainImage}
                            onChange={() => setMainImage(index)}
                            className="accent-rose-600"
                          />
                          <span className="text-xs text-zinc-600">主图</span>
                        </label>
                      </td>
                      <td className="px-3 py-3">
                        {(() => {
                          const badge = renderSkuStatusBadge(row);
                          if (!badge) {
                            return (
                              <span className="text-xs text-emerald-700">
                                可售
                              </span>
                            );
                          }
                          return (
                            <span
                              className={`text-xs font-medium ${
                                row.isActive === false
                                  ? "text-zinc-500"
                                  : "text-amber-700"
                              }`}
                            >
                              {badge}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-1">
                          <Switch
                            label="启用该规格"
                            checked={row.isActive !== false}
                            onChange={(checked) =>
                              updateSkuRow(index, { isActive: checked })
                            }
                          />
                          <p className="max-w-40 text-xs text-zinc-500">
                            关闭后，该规格不会在小程序展示，也不能被加入购物车或下单。
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => removeSkuRow(index)}
                          className="text-sm text-red-600 hover:text-red-800"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 space-y-3">
              <h4 className="text-sm font-semibold text-zinc-900">
                履约与预订规则（SKU 高级设置）
              </h4>
              <p className="text-xs text-zinc-500">
                当顾客购买数量较多时，限制最早配送日期，不影响商品上架与库存校验。
              </p>
              {skus.map((row, index) => (
                <details
                  key={row.id ?? `preorder-${index}`}
                  className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4"
                >
                  <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                    {row.specName.trim() || `款式 ${index + 1}`}
                    {row.bulkPreorderEnabled ? (
                      <span className="ml-2 text-xs font-normal text-amber-700">
                        已启用大批量提前预订
                      </span>
                    ) : null}
                  </summary>
                  <div className="mt-4 space-y-4">
                    <Switch
                      label="启用大批量提前预订"
                      checked={row.bulkPreorderEnabled}
                      onChange={(checked) =>
                        updateSkuRow(index, { bulkPreorderEnabled: checked })
                      }
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input
                        label="大批量阈值"
                        type="number"
                        min={1}
                        step={1}
                        value={row.bulkOrderThreshold}
                        onChange={(e) =>
                          updateSkuRow(index, {
                            bulkOrderThreshold: e.target.value,
                          })
                        }
                        placeholder="如：3"
                      />
                      <Input
                        label="最小提前天数"
                        type="number"
                        min={1}
                        step={1}
                        value={row.bulkMinLeadDays}
                        onChange={(e) =>
                          updateSkuRow(index, {
                            bulkMinLeadDays: e.target.value,
                          })
                        }
                        placeholder="如：1 表示不能当天送达"
                      />
                    </div>
                    <p className="text-xs text-zinc-500">
                      大批量阈值：当顾客购买该 SKU 达到此数量时，需要提前预订。
                      最小提前天数：命中规则后，最早可选择几天后的配送日期。
                    </p>
                    <label className="block text-sm font-medium text-zinc-800">
                      提示文案（可选）
                      <textarea
                        className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                        rows={2}
                        value={row.bulkPreorderMessage}
                        onChange={(e) =>
                          updateSkuRow(index, {
                            bulkPreorderMessage: e.target.value,
                          })
                        }
                        placeholder="这款花礼数量较多时需要提前备花，建议至少提前 {minLeadDays} 天预订。"
                      />
                    </label>
                    {formatBulkPreorderPreview(row) ? (
                      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        预览：{formatBulkPreorderPreview(row)}
                      </p>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </section>

          {!isNew && productId !== "new" ? (
            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-zinc-900">产品决策建议</h3>
              <div className="mt-4">
                <ProductDecisionPanel productId={productId} compact />
              </div>
            </section>
          ) : null}

          <div className="space-y-4 lg:hidden">
            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-zinc-900">小程序展示预览</h3>
              <div className="mt-4">
                <ProductMiniProgramPreview
                  name={name}
                  description={description}
                  maintenanceGuide={maintenanceGuideline}
                  tags={operationTags}
                  skus={skus.map((s) => ({
                    specName: s.specName,
                    price: s.price,
                    imageUrl: s.imageUrl,
                    isMainImage: s.isMainImage,
                  }))}
                />
              </div>
            </section>
            {sidebarMeta}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900">小程序展示预览</h3>
            <div className="mt-4">
              <ProductMiniProgramPreview
                name={name}
                description={description}
                maintenanceGuide={maintenanceGuideline}
                tags={operationTags}
                skus={skus.map((s) => ({
                  specName: s.specName,
                  price: s.price,
                  imageUrl: s.imageUrl,
                  isMainImage: s.isMainImage,
                }))}
              />
            </div>
          </section>
          <div className="hidden space-y-4 lg:block">{sidebarMeta}</div>
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 mt-8 border-t border-zinc-200 bg-white/95 px-4 py-4 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-sm pb-safe">
        <div className="mx-auto flex max-w-7xl justify-end gap-3">
          <Link
            href="/cms/products"
            className="inline-flex items-center rounded-lg border border-zinc-200 px-5 py-2.5 text-sm text-zinc-700"
          >
            取消
          </Link>
          <Button type="submit" disabled={submitting || uploadingIndex !== null}>
            {submitting ? "保存中…" : isNew ? "创建商品" : "保存商品"}
          </Button>
        </div>
      </div>

      {toast && (
        <div
          className={`fixed bottom-24 right-6 z-[60] rounded-lg px-4 py-3 text-sm text-white shadow-lg md:bottom-6 ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.message}
        </div>
      )}
    </form>
  );
}
