"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  HOME_BANNER_KEY,
  HOME_BANNER_NAME,
  createBannerId,
  sortHomeBannerItems,
  type HomeBannerItem,
} from "@/lib/home-banner";

export type ProductOption = {
  id: string;
  name: string;
  sku: string;
};

type Props = {
  initialItems: HomeBannerItem[];
  products: ProductOption[];
  updatedAt: string | null;
};

const emptyDraft = (): HomeBannerItem => ({
  id: createBannerId(),
  imageUrl: "",
  sort: 100,
  productId: "",
});

export function BannerManager({
  initialItems,
  products,
  updatedAt: initialUpdatedAt,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<HomeBannerItem[]>(() =>
    sortHomeBannerItems(initialItems)
  );
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<HomeBannerItem>(emptyDraft);
  const [uploading, setUploading] = useState(false);

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const sortedItems = useMemo(() => sortHomeBannerItems(items), [items]);

  function openAddModal() {
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort), 0);
    setDraft({ ...emptyDraft(), sort: maxSort + 10 });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setDraft(emptyDraft());
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
        alert(json.error ?? "上传失败");
        return;
      }
      setDraft((d) => ({ ...d, imageUrl: json.data!.url! }));
    } catch {
      alert("上传失败，请重试");
    } finally {
      setUploading(false);
    }
  }

  function confirmAdd() {
    if (!draft.imageUrl.trim()) {
      alert("请上传轮播海报");
      return;
    }
    if (!draft.productId) {
      alert("请选择跳转商品");
      return;
    }
    setItems((prev) =>
      sortHomeBannerItems([...prev, { ...draft, imageUrl: draft.imageUrl.trim() }])
    );
    closeModal();
  }

  function removeItem(id: string) {
    if (!confirm("确定移除该轮播图？")) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateSort(id: string, sort: number) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, sort: Math.round(sort) } : i))
    );
  }

  async function handlePublish() {
    for (const item of items) {
      if (!item.imageUrl || !item.productId) {
        alert("存在未完整的轮播项，请检查图片与跳转商品");
        return;
      }
    }

    setSaving(true);
    try {
      const payload = sortHomeBannerItems(items);
      const res = await fetch("/api/admin/app-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: HOME_BANNER_KEY,
          name: HOME_BANNER_NAME,
          value: payload,
        }),
      });

      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { message?: string; items?: HomeBannerItem[]; updatedAt?: string };
      };

      if (!res.ok || !json.success) {
        alert(json.error ?? "发布失败");
        return;
      }

      const next = json.data?.items ?? payload;
      setItems(sortHomeBannerItems(next));
      if (json.data?.updatedAt) setUpdatedAt(json.data.updatedAt);
      alert(json.data?.message ?? "已发布");
      router.refresh();
    } catch {
      alert("网络异常，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">首页轮播图</h2>
          <p className="mt-1 text-sm text-zinc-500">
            配置 key={HOME_BANNER_KEY}，控制小程序首页 Banner 与跳转商品
          </p>
          {updatedAt && (
            <p className="mt-1 text-xs text-zinc-400">
              上次发布：{new Date(updatedAt).toLocaleString("zh-CN")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={openAddModal}>
            + 新增轮播图
          </Button>
          <Button type="button" onClick={handlePublish} disabled={saving}>
            {saving ? "发布中…" : "保存发布"}
          </Button>
        </div>
      </header>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-zinc-50">
            <tr>
              <th className="px-4 py-3 font-medium text-zinc-600">海报</th>
              <th className="px-4 py-3 font-medium text-zinc-600">排序</th>
              <th className="px-4 py-3 font-medium text-zinc-600">跳转商品</th>
              <th className="px-4 py-3 font-medium text-zinc-600">商品 ID</th>
              <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sortedItems.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-12 text-center text-zinc-500"
                >
                  暂无轮播图，点击「新增轮播图」添加
                </td>
              </tr>
            ) : (
              sortedItems.map((item) => {
                const product = productMap.get(item.productId);
                return (
                  <tr key={item.id} className="hover:bg-zinc-50/50">
                    <td className="px-4 py-3">
                      <div className="relative h-16 w-28 overflow-hidden rounded-lg border border-rose-100 bg-zinc-50">
                        {item.imageUrl ? (
                          <Image
                            src={item.imageUrl}
                            alt="轮播海报"
                            fill
                            className="object-cover"
                            unoptimized
                          />
                        ) : (
                          <span className="flex h-full items-center justify-center text-xs text-zinc-400">
                            无图
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        className="w-20 rounded-lg border border-zinc-200 px-2 py-1"
                        value={item.sort}
                        onChange={(e) =>
                          updateSort(item.id, Number(e.target.value))
                        }
                      />
                      <p className="mt-0.5 text-xs text-zinc-400">越小越靠前</p>
                    </td>
                    <td className="px-4 py-3">
                      {product ? (
                        <>
                          <p className="font-medium text-zinc-900">
                            {product.name}
                          </p>
                          <p className="text-xs text-zinc-500">{product.sku}</p>
                        </>
                      ) : (
                        <span className="text-amber-600">商品已下架或不存在</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                      {item.productId}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => removeItem(item.id)}
                      >
                        移除
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="banner-modal-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3
              id="banner-modal-title"
              className="text-lg font-semibold text-rose-900"
            >
              新增轮播图
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              上传海报并选择点击后跳转的商城商品
            </p>

            <div className="mt-6 space-y-4">
              <div>
                <span className="mb-2 block text-sm font-medium text-zinc-700">
                  轮播海报
                </span>
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
                {draft.imageUrl ? (
                  <div>
                    <div className="relative mb-2 h-36 w-full overflow-hidden rounded-xl border border-rose-100">
                      <Image
                        src={draft.imageUrl}
                        alt="预览"
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      {uploading ? "上传中…" : "更换图片"}
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="flex h-32 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/30 text-sm text-rose-700 hover:border-rose-300"
                  >
                    {uploading ? "上传中…" : "点击上传海报（JPG / PNG / WebP）"}
                  </button>
                )}
              </div>

              <Input
                label="排序权重"
                type="number"
                value={String(draft.sort)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, sort: Number(e.target.value) }))
                }
              />

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-zinc-700">
                  跳转商品
                </span>
                <select
                  value={draft.productId}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, productId: e.target.value }))
                  }
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                >
                  <option value="">请选择成品商品</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}（{p.sku}）
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeModal}>
                取消
              </Button>
              <Button
                type="button"
                onClick={confirmAdd}
                disabled={uploading}
              >
                加入列表
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
