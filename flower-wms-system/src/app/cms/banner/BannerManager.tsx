"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { CmsLinkTargetSelector } from "@/components/cms/pickers/CmsLinkTargetSelector";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/Switch";
import type { BannerWriteItem } from "@/lib/banner";
import {
  bannerToLinkTarget,
  CMS_LINK_TARGET_LABELS,
  getBannerLinkTargetLegacyWarning,
  linkTargetToBannerFields,
  validateCmsLinkTarget,
  type CmsLinkTarget,
} from "@/lib/cms-link-target";

type BannerRow = BannerWriteItem & {
  id: string;
  createdAt?: string;
  updatedAt?: string;
};

type BannerForm = {
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
};

const EMPTY_FORM: BannerForm = {
  imageUrl: "",
  sortOrder: 100,
  isActive: true,
};

const emptyLinkTarget = (): CmsLinkTarget => ({ targetType: "NONE" });

function formFromRow(row: BannerRow): BannerForm {
  return {
    imageUrl: row.imageUrl,
    sortOrder: row.sortOrder,
    isActive: row.isActive !== false,
  };
}

function formatUpdatedAt(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function renderJumpSummary(item: BannerRow) {
  const target = bannerToLinkTarget(item);
  const legacyWarning = getBannerLinkTargetLegacyWarning(item);

  if (legacyWarning) {
    return <span className="text-amber-600">{legacyWarning}</span>;
  }

  if (target.targetType === "NONE") {
    return <span className="text-zinc-500">不跳转</span>;
  }

  return (
    <>
      <p className="font-medium text-zinc-800">
        {CMS_LINK_TARGET_LABELS[target.targetType]}
      </p>
      <p className="text-xs text-zinc-500">
        {target.customUrl ||
          target.couponCode ||
          target.sceneType ||
          target.slotKey ||
          target.categoryId ||
          target.productId ||
          "—"}
      </p>
    </>
  );
}

export function BannerManager() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [banners, setBanners] = useState<BannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BannerForm>(EMPTY_FORM);
  const [linkTarget, setLinkTarget] = useState<CmsLinkTarget>(emptyLinkTarget);
  const [uploading, setUploading] = useState(false);
  const [legacyWarning, setLegacyWarning] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const loadBanners = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        "/api/admin/cms/banners?includeInactive=true"
      );
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { banners?: BannerRow[] };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "加载失败");
      }
      const rows = json.data?.banners ?? [];
      setBanners(
        [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBanners();
  }, [loadBanners]);

  function openCreate() {
    const maxSort = banners.reduce((m, i) => Math.max(m, i.sortOrder), 0);
    setEditingId(null);
    setForm({ ...EMPTY_FORM, sortOrder: maxSort + 10 });
    setLinkTarget(emptyLinkTarget());
    setLegacyWarning(null);
    setModalOpen(true);
  }

  function openEdit(row: BannerRow) {
    setEditingId(row.id);
    setForm(formFromRow(row));
    setLinkTarget(bannerToLinkTarget(row));
    setLegacyWarning(getBannerLinkTargetLegacyWarning(row));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setLinkTarget(emptyLinkTarget());
    setLegacyWarning(null);
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
        throw new Error(json.error ?? "上传失败");
      }
      setForm((f) => ({ ...f, imageUrl: json.data!.url! }));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!form.imageUrl.trim()) {
      showToast("请上传轮播海报");
      return;
    }
    const linkError = validateCmsLinkTarget(linkTarget);
    if (linkError) {
      showToast(linkError);
      return;
    }

    const jumpFields = linkTargetToBannerFields(linkTarget);
    const payload = {
      imageUrl: form.imageUrl.trim(),
      sortOrder: form.sortOrder,
      isActive: form.isActive,
      ...jumpFields,
    };

    setSaving(true);
    try {
      const url = editingId
        ? `/api/admin/cms/banners/${editingId}`
        : "/api/admin/cms/banners";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "保存失败");
      }
      showToast(editingId ? "已更新" : "已创建");
      closeModal();
      await loadBanners();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(row: BannerRow) {
    try {
      const res = await fetch(`/api/admin/cms/banners/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "操作失败");
      }
      showToast(row.isActive ? "已停用" : "已启用");
      await loadBanners();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function handleDelete(row: BannerRow) {
    if (
      !window.confirm(
        "确定要删除这个轮播图吗？删除后小程序首页将不再展示。"
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/cms/banners/${row.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "删除失败");
      }
      showToast("已删除");
      await loadBanners();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function handleSortChange(row: BannerRow, sortOrder: number) {
    const nextSort = Math.round(sortOrder);
    if (!Number.isFinite(nextSort)) return;

    setBanners((prev) =>
      prev
        .map((b) => (b.id === row.id ? { ...b, sortOrder: nextSort } : b))
        .sort((a, b) => a.sortOrder - b.sortOrder)
    );

    try {
      const res = await fetch(`/api/admin/cms/banners/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: nextSort }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "排序保存失败");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "排序保存失败");
      await loadBanners();
    }
  }

  return (
    <div className="relative space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">首页轮播图</h2>
          <p className="mt-1 text-sm text-zinc-500">
            配置小程序首页顶部轮播海报与点击跳转；停用后前台不再展示。
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          + 新增轮播图
        </Button>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{error}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={() => void loadBanners()}
          >
            重试
          </Button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : banners.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-6 py-10 text-center shadow-sm">
          <h3 className="text-base font-semibold text-zinc-900">
            还没有首页轮播图
          </h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-zinc-500">
            添加轮播图后，小程序首页顶部将展示它们。
          </p>
          <Button type="button" className="mt-6" onClick={openCreate}>
            新增轮播图
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="px-4 py-3 font-medium text-zinc-600">海报</th>
                <th className="px-4 py-3 font-medium text-zinc-600">排序</th>
                <th className="px-4 py-3 font-medium text-zinc-600">
                  跳转目标
                </th>
                <th className="px-4 py-3 font-medium text-zinc-600">状态</th>
                <th className="px-4 py-3 font-medium text-zinc-600">
                  更新时间
                </th>
                <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {banners.map((item) => (
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
                        void handleSortChange(item, Number(e.target.value))
                      }
                    />
                    <p className="mt-0.5 text-xs text-zinc-400">越小越靠前</p>
                  </td>
                  <td className="px-4 py-3">{renderJumpSummary(item)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={item.isActive !== false ? "success" : "default"}>
                      {item.isActive !== false ? "启用" : "停用"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    {formatUpdatedAt(item.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => openEdit(item)}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void handleToggleActive(item)}
                      >
                        {item.isActive !== false ? "停用" : "启用"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void handleDelete(item)}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-rose-900">
              {editingId ? "编辑轮播图" : "新增轮播图"}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              配置海报与点击后的跳转行为
            </p>

            {legacyWarning ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {legacyWarning}
              </p>
            ) : null}

            <div className="mt-6 space-y-4">
              <div>
                <span className="mb-2 block text-sm font-medium text-zinc-700">
                  轮播海报 *
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
                {form.imageUrl ? (
                  <div>
                    <div className="relative mb-2 h-36 w-full overflow-hidden rounded-xl border border-rose-100">
                      <Image
                        src={form.imageUrl}
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
                value={String(form.sortOrder)}
                onChange={(e) =>
                  setForm((d) => ({
                    ...d,
                    sortOrder: Number(e.target.value) || 0,
                  }))
                }
              />
              <p className="-mt-2 text-xs text-zinc-500">数值越小越靠前</p>

              <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2">
                <span className="text-sm font-medium text-zinc-700">启用</span>
                <Switch
                  checked={form.isActive}
                  onChange={(checked) =>
                    setForm((d) => ({ ...d, isActive: checked }))
                  }
                />
              </div>

              <CmsLinkTargetSelector
                value={linkTarget}
                onChange={setLinkTarget}
                showCoupon
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeModal}>
                取消
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={uploading || saving}
              >
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
