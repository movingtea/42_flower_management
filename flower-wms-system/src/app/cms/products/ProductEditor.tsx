"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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

const SHIPPING_FEE_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
const SHIPPING_FEE_ERROR_MSG =
  "请输入正确的运费金额，最多支持两位小数";

function emptySkuRow(sortOrder = 0): ProductSkuEditorRow {
  return {
    specName: "",
    price: "",
    stock: 0,
    imageUrl: "",
    isMainImage: sortOrder === 0,
    sortOrder,
  };
}

export function ProductEditor({ productId, isNew, initial }: ProductEditorProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const [name, setName] = useState(initial.name);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initial.category
  );
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
  const [recipeId, setRecipeId] = useState<string | null>(initial.recipeId);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2800);
  }

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
    }

    const payload = {
      name: name.trim(),
      category: selectedCategories,
      isActive: isPublished,
      needsShipping,
      shippingFee: needsShipping ? Number(shippingFee.trim()) : 0,
      description: description.trim() || null,
      maintenanceGuide: maintenanceGuideline.trim() || null,
      recipeId,
      skus: skus.map((row, index) => ({
        id: row.id,
        skuCode: row.skuCode,
        specName: row.specName.trim(),
        price: Number(row.price),
        stock: row.stock,
        imageUrl: row.imageUrl.trim() || null,
        isMainImage: row.isMainImage,
        sortOrder: row.sortOrder ?? index * 10,
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

      router.push("/cms/products");
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
        <RecipeSelect
          value={recipeId}
          onChange={setRecipeId}
          disabled={submitting}
        />
      </section>

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
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  款式列表（SKU / 主图）
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  指定一个「商品卡片主图」用于小程序列表封面
                </p>
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
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">款式品名</th>
                    <th className="px-3 py-2 font-medium">价格</th>
                    <th className="px-3 py-2 font-medium">库存</th>
                    <th className="px-3 py-2 font-medium">款式图</th>
                    <th className="px-3 py-2 font-medium">主图</th>
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
          </section>

          <div className="space-y-4 lg:hidden">{sidebarMeta}</div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
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
