"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {useCallback, useRef, useState} from "react";
import { useDeferredEffect } from "@/lib/defer-effect";
import { ProductSkuEditorCards } from "@/components/cms/ProductSkuEditorCards";
import { ProductCategoryTreeSelect } from "@/components/cms/ProductCategoryTreeSelect";
import { RichTextEditorLazy } from "@/components/cms/RichTextEditorLazy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegerStringInput } from "@/components/ui/NumberInput";
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
import { uploadCmsImage } from "@/lib/cms-image-upload";
import {
  countEnabledSkus,
  createDefaultSkuDraftRow,
  resolveSkuSpecNameForSave,
} from "@/lib/cms/single-spec-product";
import type { ProductMarginEstimate } from "@/services/product-margin";

const SHIPPING_FEE_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
const SHIPPING_FEE_ERROR_MSG =
  "请输入正确的运费金额，最多支持两位小数";

type ProductMarginApiResponse = {
  success: boolean;
  data?: ProductMarginEstimate;
  error?: string;
};

function emptySkuRow(sortOrder = 0): ProductSkuEditorRow {
  return createDefaultSkuDraftRow(sortOrder);
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

  useDeferredEffect(() => loadMarginEstimate(), [loadMarginEstimate]);

  async function handleSkuImageUpload(file: File, index: number) {
    if (uploadingIndex !== null) return;
    setUploadingIndex(index);
    try {
      const { objectKey } = await uploadCmsImage(file, "product-sku");
      setSkus((prev) =>
        prev.map((row, i) => (i === index ? { ...row, imageUrl: objectKey } : row))
      );
      showToast("图片上传成功", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "上传失败，请稍后重试", "error");
    } finally {
      setUploadingIndex(null);
    }
  }

  function addSkuRow() {
    setSkus((prev) => {
      const maxSort = prev.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
      return [
        ...prev,
        {
          ...createDefaultSkuDraftRow(maxSort + 10),
          specName: "",
          isMainImage: false,
        },
      ];
    });
  }

  function removeSkuRow(index: number) {
    if (skus.length <= 1) {
      showToast("请至少保留一个规格", "error");
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
    if (
      patch.isActive === false &&
      isPublished &&
      countEnabledSkus(skus) <= 1 &&
      skus[index]?.isActive !== false
    ) {
      showToast("已上架商品请至少保留一个启用规格，或先下架商品", "error");
      return;
    }
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

    if (isPublished && countEnabledSkus(skus) === 0) {
      showToast("请至少保留一个启用规格，或先下架商品", "error");
      return;
    }

    for (let i = 0; i < skus.length; i++) {
      const row = skus[i];
      try {
        resolveSkuSpecNameForSave(row.specName, skus.length, i);
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : `请填写第 ${i + 1} 行的款式品名`,
          "error"
        );
        return;
      }
      const price = Number(row.price);
      if (!Number.isFinite(price) || price < 0) {
        showToast(`第 ${i + 1} 行价格无效`, "error");
        return;
      }
      if (row.stock == null || !Number.isInteger(row.stock) || row.stock < 0) {
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
        specName: resolveSkuSpecNameForSave(row.specName, skus.length, index),
        price: Number(row.price),
        stock: row.stock ?? 0,
        imageUrl: row.imageUrl.trim() || null,
        isMainImage: row.isMainImage,
        isActive: row.isActive !== false,
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
            填写商品信息与价格库存；单规格商品无需手动添加款式
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

          <ProductSkuEditorCards
            skus={skus}
            marginEstimate={marginEstimate}
            marginLoading={marginLoading}
            marginError={marginError}
            uploadingIndex={uploadingIndex}
            submitting={submitting}
            onAddRow={addSkuRow}
            onUpdateRow={updateSkuRow}
            onRemoveRow={removeSkuRow}
            onSetMainImage={setMainImage}
            onPickImage={(index) => {
              if (fileRef.current) {
                fileRef.current.dataset.index = String(index);
                fileRef.current.click();
              }
            }}
          />

          <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="space-y-3">
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
                      <IntegerStringInput
                        label="大批量阈值"
                        value={row.bulkOrderThreshold ?? ""}
                        onChange={(bulkOrderThreshold) =>
                          updateSkuRow(index, { bulkOrderThreshold })
                        }
                        placeholder="如：3"
                      />
                      <IntegerStringInput
                        label="最小提前天数"
                        value={row.bulkMinLeadDays ?? ""}
                        onChange={(bulkMinLeadDays) =>
                          updateSkuRow(index, { bulkMinLeadDays })
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
