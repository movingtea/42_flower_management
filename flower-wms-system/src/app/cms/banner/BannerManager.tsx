"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BANNER_TARGET_TYPE_LABELS,
  BANNER_TARGET_TYPES,
  type BannerTargetTypeValue,
  type BannerWriteItem,
} from "@/lib/banner";
import { createBannerId } from "@/lib/home-banner";

export type ProductOption = {
  id: string;
  name: string;
  sku: string;
};

type Props = {
  initialItems: BannerWriteItem[];
  products: ProductOption[];
};

const emptyDraft = (): BannerWriteItem => ({
  id: createBannerId(),
  imageUrl: "",
  sortOrder: 100,
  targetType: "NONE",
  targetParam: null,
  productId: null,
  isActive: true,
});

function targetTypeLabel(type: BannerTargetTypeValue): string {
  return BANNER_TARGET_TYPE_LABELS[type] ?? type;
}

export function BannerManager({ initialItems, products }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<BannerWriteItem[]>(() =>
    [...initialItems].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<BannerWriteItem>(emptyDraft);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }

  function openAddModal() {
    const maxSort = items.reduce((m, i) => Math.max(m, i.sortOrder), 0);
    setDraft({ ...emptyDraft(), sortOrder: maxSort + 10 });
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
    if (draft.targetType === "PRODUCT" && !draft.productId) {
      alert("请选择跳转商品");
      return;
    }
    if (
      (draft.targetType === "ACTIVITY" || draft.targetType === "COUPON") &&
      !draft.targetParam?.trim()
    ) {
      alert("请填写跳转参数");
      return;
    }

    setItems((prev) =>
      [...prev, { ...draft, imageUrl: draft.imageUrl.trim() }].sort(
        (a, b) => a.sortOrder - b.sortOrder
      )
    );
    closeModal();
  }

  function removeItem(id: string) {
    if (!confirm("确定移除该轮播图？")) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateSort(id: string, sortOrder: number) {
    setItems((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, sortOrder: Math.round(sortOrder) } : i))
        .sort((a, b) => a.sortOrder - b.sortOrder)
    );
  }

  function renderJumpSummary(item: BannerWriteItem) {
    if (item.targetType === "PRODUCT") {
      const product = item.productId
        ? productMap.get(item.productId)
        : undefined;
      return product ? (
        <>
          <p className="font-medium text-zinc-900">{product.name}</p>
          <p className="text-xs text-zinc-500">{product.sku}</p>
        </>
      ) : (
        <span className="text-amber-600">商品已下架或不存在</span>
      );
    }
    if (item.targetType === "NONE") {
      return <span className="text-zinc-500">不跳转</span>;
    }
    return (
      <>
        <p className="font-medium text-zinc-800">
          {targetTypeLabel(item.targetType)}
        </p>
        <p className="text-xs text-zinc-500">{item.targetParam || "—"}</p>
      </>
    );
  }

  async function handlePublish() {
    for (const item of items) {
      if (!item.imageUrl) {
        alert("存在未上传海报的轮播项");
        return;
      }
      if (item.targetType === "PRODUCT" && !item.productId) {
        alert("存在未选择商品的轮播项");
        return;
      }
      if (
        (item.targetType === "ACTIVITY" || item.targetType === "COUPON") &&
        !item.targetParam?.trim()
      ) {
        alert("存在未填写跳转参数的轮播项");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/banners", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banners: items }),
      });

      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { message?: string; banners?: BannerWriteItem[] };
      };

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "发布失败");
      }

      const next = json.data?.banners ?? items;
      setItems(next);
      showToast(json.data?.message ?? "轮播已保存", "success");
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "发布失败", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      {toast ? (
        <div
          role="status"
          className={`fixed right-6 top-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">首页轮播图</h2>
          <p className="mt-1 text-sm text-zinc-500">
            支持跳转商品、活动页、优惠券或仅展示；商品软删除后前台自动不跳转。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={openAddModal}>
            + 新增轮播图
          </Button>
          <Button type="button" onClick={handlePublish} disabled={saving}>
            {saving ? "保存中…" : "保存发布"}
          </Button>
        </div>
      </header>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-zinc-50">
            <tr>
              <th className="px-4 py-3 font-medium text-zinc-600">海报</th>
              <th className="px-4 py-3 font-medium text-zinc-600">排序</th>
              <th className="px-4 py-3 font-medium text-zinc-600">跳转类型</th>
              <th className="px-4 py-3 font-medium text-zinc-600">跳转目标</th>
              <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-12 text-center text-zinc-500"
                >
                  暂无轮播图，点击「新增轮播图」添加
                </td>
              </tr>
            ) : (
              items.map((item) => (
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
                      value={item.sortOrder}
                      onChange={(e) =>
                        updateSort(item.id!, Number(e.target.value))
                      }
                    />
                    <p className="mt-0.5 text-xs text-zinc-400">越小越靠前</p>
                  </td>
                  <td className="px-4 py-3">
                    {targetTypeLabel(item.targetType)}
                  </td>
                  <td className="px-4 py-3">{renderJumpSummary(item)}</td>
                  <td className="px-4 py-3">
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => item.id && removeItem(item.id)}
                    >
                      移除
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-rose-900">新增轮播图</h3>
            <p className="mt-1 text-sm text-zinc-500">
              配置海报与点击后的跳转行为
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
                value={String(draft.sortOrder)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, sortOrder: Number(e.target.value) }))
                }
              />

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-zinc-700">
                  跳转类型
                </span>
                <select
                  value={draft.targetType}
                  onChange={(e) => {
                    const targetType = e.target
                      .value as BannerTargetTypeValue;
                    setDraft((d) => ({
                      ...d,
                      targetType,
                      productId:
                        targetType === "PRODUCT" ? d.productId : null,
                      targetParam:
                        targetType === "ACTIVITY" || targetType === "COUPON"
                          ? d.targetParam
                          : null,
                    }));
                  }}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                >
                  {BANNER_TARGET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {BANNER_TARGET_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>

              {draft.targetType === "PRODUCT" && (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-zinc-700">
                    跳转商品
                  </span>
                  <select
                    value={draft.productId ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        productId: e.target.value || null,
                      }))
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
              )}

              {(draft.targetType === "ACTIVITY" ||
                draft.targetType === "COUPON") && (
                <Input
                  label={
                    draft.targetType === "ACTIVITY"
                      ? "活动页路径或标识"
                      : "优惠券 ID 或活动码"
                  }
                  value={draft.targetParam ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      targetParam: e.target.value,
                    }))
                  }
                  placeholder={
                    draft.targetType === "ACTIVITY"
                      ? "例如 /pages/activity/spring"
                      : "例如 COUPON_2026_SPRING"
                  }
                />
              )}
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
