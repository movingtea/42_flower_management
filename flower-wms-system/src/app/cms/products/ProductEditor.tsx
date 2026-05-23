"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ProductCategoryTreeSelect } from "@/components/cms/ProductCategoryTreeSelect";
import { RichTextEditorLazy } from "@/components/cms/RichTextEditorLazy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/Switch";
import type { ProductEditorProps } from "@/app/cms/products/types";

const SHIPPING_FEE_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
const SHIPPING_FEE_ERROR_MSG =
  "请输入正确的运费金额，最多支持两位小数";

export function ProductEditor({ productId, isNew, initial }: ProductEditorProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const displaySku = isNew ? "" : initial.sku;
  const [name, setName] = useState(initial.name);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initial.category
  );
  const [sellPrice, setSellPrice] = useState(initial.sellPrice);
  const [quantity, setQuantity] = useState(String(initial.quantity));
  const [isPublished, setIsPublished] = useState(initial.isActive);
  const [description, setDescription] = useState(initial.description);
  const [maintenanceGuideline, setMaintenanceGuideline] = useState(
    initial.careTips
  );
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);
  const [needsShipping, setNeedsShipping] = useState(initial.needsShipping);
  const [shippingFee, setShippingFee] = useState(initial.shippingFee);
  const [shippingFeeError, setShippingFeeError] = useState("");

  async function handleUpload(file: File) {
    setUploading(true);
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
        alert(json.error ?? "上传失败，请稍后重试");
        return;
      }
      setImageUrl(url);
    } catch {
      alert("网络异常，请检查连接后重试");
    } finally {
      setUploading(false);
    }
  }

  function validateShippingFeeInput(): boolean {
    if (!needsShipping) {
      setShippingFeeError("");
      return true;
    }

    const text = shippingFee.trim();
    if (!text) {
      setShippingFeeError(SHIPPING_FEE_ERROR_MSG);
      return false;
    }

    if (!SHIPPING_FEE_PATTERN.test(text)) {
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
    if (!checked) {
      setShippingFee("");
    }
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();

    if (selectedCategories.length === 0) {
      alert("请至少选择一个商品分类");
      return;
    }

    if (!validateShippingFeeInput()) {
      return;
    }

    const payload = {
      name: name.trim(),
      category: selectedCategories,
      sellPrice: sellPrice === "" ? null : Number(sellPrice),
      quantity: Number(quantity),
      isActive: isPublished,
      needsShipping,
      shippingFee: needsShipping ? Number(shippingFee.trim()) : 0,
      description: description.trim() || null,
      careTips: maintenanceGuideline.trim() || null,
      imageUrl: imageUrl.trim() || null,
    };

    if (!payload.name) {
      alert("请填写商品名称");
      return;
    }

    if (!Number.isInteger(payload.quantity) || payload.quantity < 0) {
      alert("可售数量须为非负整数");
      return;
    }

    setSubmitting(true);
    try {
      const url = isNew
        ? "/api/cms/products"
        : `/api/cms/products/${productId}`;
      const method = isNew ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { message?: string };
      };

      if (!res.ok || !json.success) {
        alert(json.error ?? "保存失败，请稍后重试");
        return;
      }

      alert(json.data?.message ?? "保存成功");
      router.push("/cms/products");
      router.refresh();
    } catch {
      alert("网络异常，请检查连接后重试");
    } finally {
      setSubmitting(false);
    }
  }

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
            左侧编辑详情与养护说明，右侧填写基础信息与分类。
          </p>
        </div>
        <Link
          href="/cms/products"
          className="text-sm text-rose-600 hover:underline"
        >
          返回商品列表
        </Link>
      </div>

      <div className="flex flex-1 flex-col gap-6 lg:flex-row">
        <div className="w-full space-y-6 lg:w-2/3">
          <RichTextEditorLazy
            label="商品描述"
            value={description}
            onChange={setDescription}
            placeholder="请输入商品描述，支持图文排版"
            minHeight={420}
          />
          <RichTextEditorLazy
            label="养护指南"
            value={maintenanceGuideline}
            onChange={setMaintenanceGuideline}
            placeholder="请输入养护指南，支持图文排版"
            minHeight={400}
          />

          <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900">商品图片</h3>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
                e.target.value = "";
              }}
            />

            {imageUrl ? (
              <div className="relative inline-block">
                <div className="relative h-48 w-48 overflow-hidden rounded-xl border border-rose-100">
                  <Image
                    src={imageUrl}
                    alt="商品图片"
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setImageUrl("")}
                  className="mt-2 text-sm text-red-600 hover:underline"
                >
                  删除图片
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex h-40 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/30 text-sm text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-50"
              >
                {uploading ? "上传中…" : "上传商品图片（JPG / PNG / WebP）"}
              </button>
            )}

            {imageUrl ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "上传中…" : "更换图片"}
              </Button>
            ) : null}
          </section>
        </div>

        <aside className="w-full space-y-4 lg:sticky lg:top-4 lg:w-1/3 lg:self-start">
          <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900">基础信息</h3>

            <Input
              label="商品名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="请输入商品名称"
            />

            <Input
              label="SKU"
              value={displaySku}
              readOnly
              disabled
              placeholder="保存后由系统自动生成"
              className="cursor-not-allowed bg-gray-100 text-gray-400"
              title={isNew ? "保存后由系统自动分配" : displaySku}
            />

            <Input
              label="零售价（元）"
              type="number"
              min={0}
              step={0.01}
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              placeholder="例如 198"
            />

            <div className="rounded-lg border border-zinc-200 px-4 py-4">
              <Switch
                label="是否需要运费"
                checked={needsShipping}
                onChange={onNeedsShippingChange}
              />
              <p className="mt-2 text-xs text-zinc-500">
                关闭视为免运费；开启后须填写单件运费金额。
              </p>
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
                    placeholder="例如 15.00"
                  />
                  {shippingFeeError ? (
                    <p className="mt-2 text-sm text-red-600" role="alert">
                      {shippingFeeError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <ProductCategoryTreeSelect
              value={selectedCategories}
              onChange={setSelectedCategories}
            />

            <p className="text-xs text-zinc-500">
              只需勾选实际分类；保存时系统将自动关联所选子分类的上级分类。
            </p>
            <p className="text-xs text-zinc-500">
              尚无分类？
              <Link
                href="/cms/product-categories"
                className="mx-1 text-rose-600 underline"
              >
                前往商品分类管理
              </Link>
            </p>
          </section>

          <section className="space-y-4 rounded-xl border border-rose-100 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-rose-900">库存与上架</h3>

            <Input
              label="可售数量"
              type="number"
              min={0}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
            />

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-200 px-4 py-3">
              <div>
                <span className="font-medium text-zinc-800">上架状态</span>
                <p className="text-xs text-zinc-500">
                  开启后商品将在前台展示
                </p>
              </div>
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="h-5 w-5 accent-rose-600"
              />
            </label>
          </section>
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-zinc-200 bg-white/95 px-4 py-4 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-sm pb-safe lg:-mx-0 lg:rounded-xl lg:border lg:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <p className="hidden text-sm text-zinc-500 sm:block">
            修改后请点击保存，未保存离开将丢失编辑内容。
          </p>
          <div className="flex w-full flex-wrap justify-end gap-3 sm:w-auto">
            <Link
              href="/cms/products"
              className="inline-flex items-center rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              取消
            </Link>
            <Button type="submit" disabled={submitting || uploading}>
              {submitting ? "保存中…" : isNew ? "创建商品" : "保存商品"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
