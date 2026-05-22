"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProductEditorProps } from "@/app/cms/products/types";

export function ProductEditor({
  productId,
  isNew,
  initial,
  categoryOptions,
}: ProductEditorProps) {
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
  const [careTips, setCareTips] = useState(initial.careTips);
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);

  function toggleCategory(value: string) {
    setSelectedCategories((prev) =>
      prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value]
    );
  }

  function removeCategory(value: string) {
    setSelectedCategories((prev) => prev.filter((v) => v !== value));
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { url?: string };
      };
      if (!res.ok || !json.success || !json.data?.url) {
        alert(json.error ?? "上传失败，请稍后重试");
        return;
      }
      setImageUrl(json.data.url);
    } catch {
      alert("网络异常，请检查连接后重试");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();

    if (selectedCategories.length === 0) {
      alert("请选择至少一个分类");
      return;
    }

    const payload = {
      name: name.trim(),
      category: selectedCategories,
      sellPrice: sellPrice === "" ? null : Number(sellPrice),
      quantity: Number(quantity),
      isActive: isPublished,
      description: description.trim() || null,
      careTips: careTips.trim() || null,
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

  const labelByValue = new Map(
    categoryOptions.map((c) => [c.value, c.label])
  );

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">
            {isNew ? "新增商品" : "编辑商品"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            用于管理商品信息。
          </p>
        </div>
        <Link
          href="/cms/products"
          className="text-sm text-rose-600 hover:underline"
        >
          返回商品列表
        </Link>
      </div>

      <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-zinc-900">商品信息</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="SKU"
            value={displaySku}
            readOnly
            disabled
            placeholder="系统自动生成"
            className="cursor-not-allowed bg-gray-100 text-gray-400"
            title={isNew ? "保存后由系统自动分配" : displaySku}
          />
          <Input
            label="商品名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <span className="mb-2 block text-sm font-medium text-zinc-700">
            分类
          </span>
          {categoryOptions.length === 0 ? (
            <p className="text-sm text-amber-700">
              暂无分类，请先创建分类。
              <Link href="/cms/categories" className="mx-1 text-rose-600 underline">
                创建分类
              </Link>
              并关联到商品。
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {categoryOptions.map((opt) => {
                const checked = selectedCategories.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                      checked
                        ? "border-rose-300 bg-rose-50"
                        : "border-zinc-200 hover:border-rose-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCategory(opt.value)}
                      className="h-4 w-4 accent-rose-600"
                    />
                    <span>
                      <span className="block text-sm font-medium text-zinc-900">
                        {opt.label}
                      </span>
                      <span className="text-xs text-zinc-500">{opt.value}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {selectedCategories.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedCategories.map((value) => (
                <span
                  key={value}
                  className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-800"
                >
                  {labelByValue.get(value) ?? value}
                  <button
                    type="button"
                    onClick={() => removeCategory(value)}
                    className="ml-1 rounded-full hover:bg-rose-200 px-1"
                    aria-label={`删除分类 ${value}`}
                  >
                    删除
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

      </section>

      <section className="space-y-4 rounded-xl border border-rose-100 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-rose-900">商品价格</h3>
        <Input
          label="零售价"
          type="number"
          min={0}
          step={0.01}
          value={sellPrice}
          onChange={(e) => setSellPrice(e.target.value)}
          placeholder="198"
        />

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
            <p className="text-xs text-zinc-500">上架状态</p>
          </div>
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
            className="h-5 w-5 accent-rose-600"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">商品描述</span>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            placeholder="请输入商品描述"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">养护指南</span>
          <textarea
            rows={3}
            value={careTips}
            onChange={(e) => setCareTips(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            placeholder="请输入养护指南"
          />
        </label>
      </section>

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
            className="flex h-40 w-full max-w-md flex-col items-center justify-center rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/30 text-sm text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-50"
          >
            {uploading ? "上传中..." : "上传商品图片（JPG / PNG / WebP）"}
          </button>
        )}

        {imageUrl && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "上传中..." : "上传商品图片"}
          </Button>
        )}
      </section>

      <div className="flex gap-3 pb-8">
        <Button type="submit" disabled={submitting || uploading}>
          {submitting ? "保存中..." : isNew ? "新增商品" : "保存商品"}
        </Button>
        <Link
          href="/cms/products"
          className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
        >
          返回商品列表
        </Link>
      </div>
    </form>
  );
}
