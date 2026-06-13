"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { CmsLinkTargetSelector } from "@/components/cms/pickers/CmsLinkTargetSelector";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { DrawerFooterActions } from "@/components/admin/DrawerFooterActions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/NumberInput";
import { Switch } from "@/components/ui/Switch";
import {
  CMS_IMAGE_REUPLOAD_HINT,
  isClientImageInvalid,
  resolveClientImagePreview,
  uploadCmsImage,
} from "@/lib/cms-image-upload";
import { useDeferredEffect } from "@/lib/defer-effect";
import type { BannerWriteItem } from "@/lib/banner";
import {
  bannerToLinkTarget,
  CMS_LINK_TARGET_LABELS,
  getBannerLinkTargetLegacyWarning,
  linkTargetToBannerFields,
  validateCmsLinkTarget,
  type CmsLinkTarget,
} from "@/lib/cms-link-target";
import {
  STICKY_LEFT_CELL,
  STICKY_LEFT_HEAD,
  STICKY_RIGHT_CELL,
  STICKY_RIGHT_HEAD,
  STICKY_SCROLL_CELL,
  STICKY_SCROLL_HEAD,
  STICKY_ACTIONS,
  STICKY_TABLE_ROW,
  StickyTableScroll,
} from "@/components/admin/sticky-table";

type BannerRow = BannerWriteItem & {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  displayStatus?: string;
  isDeleted?: boolean;
};

type BannerForm = {
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
};

const EMPTY_FORM: BannerForm = {
  imageUrl: "",
  sortOrder: 100,
  isActive: true,
  startsAt: "",
  endsAt: "",
};

function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function displayStatusVariant(status?: string) {
  switch (status) {
    case "展示中":
      return "success" as const;
    case "未开始":
      return "warning" as const;
    case "已过期":
    case "已停用":
    case "已删除":
      return "default" as const;
    default:
      return "default" as const;
  }
}

const emptyLinkTarget = (): CmsLinkTarget => ({ targetType: "NONE" });

function formFromRow(row: BannerRow): BannerForm {
  return {
    imageUrl: row.imageUrl,
    sortOrder: row.sortOrder,
    isActive: row.isActive !== false,
    startsAt: toDatetimeLocalValue(row.startsAt),
    endsAt: toDatetimeLocalValue(row.endsAt),
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  useDeferredEffect(() => loadBanners(), [loadBanners]);

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
    if (uploading) return;
    setUploading(true);
    try {
      const { objectKey } = await uploadCmsImage(file, "banner");
      setForm((f) => ({ ...f, imageUrl: objectKey }));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!form.imageUrl.trim()) {
      showToast("请上传轮播图");
      return;
    }
    if (isClientImageInvalid(form.imageUrl)) {
      showToast(CMS_IMAGE_REUPLOAD_HINT);
      return;
    }
    const linkError = validateCmsLinkTarget(linkTarget);
    if (linkError) {
      showToast(linkError);
      return;
    }

    const jumpFields = linkTargetToBannerFields(linkTarget);
    if (form.startsAt && form.endsAt) {
      const start = new Date(form.startsAt);
      const end = new Date(form.endsAt);
      if (start.getTime() > end.getTime()) {
        showToast("开始时间不能晚于结束时间");
        return;
      }
    }

    const payload = {
      imageUrl: form.imageUrl.trim(),
      sortOrder: form.sortOrder,
      isActive: form.isActive,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
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
    if (deletingId) return;
    if (
      !window.confirm(
        "确定要删除这个首页轮播图吗？删除后小程序首页将不再展示，但历史记录会保留。"
      )
    ) {
      return;
    }

    setDeletingId(row.id);
    try {
      const res = await fetch(`/api/admin/cms/banners/${row.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? json.message ?? "删除失败");
      }
      setBanners((prev) => prev.filter((b) => b.id !== row.id));
      showToast("已删除");
      await loadBanners();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingId(null);
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
            配置小程序首页顶部轮播图与点击跳转；停用后前台不再展示。
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
          <StickyTableScroll minWidth="900px">
            <colgroup>
              <col className="w-36" />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col className="w-32" />
            </colgroup>
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className={STICKY_LEFT_HEAD}>轮播图</th>
                <th className={STICKY_SCROLL_HEAD}>排序</th>
                <th className={STICKY_SCROLL_HEAD}>跳转目标</th>
                <th className={STICKY_SCROLL_HEAD}>展示状态</th>
                <th className={STICKY_SCROLL_HEAD}>有效期</th>
                <th className={STICKY_SCROLL_HEAD}>更新时间</th>
                <th className={STICKY_RIGHT_HEAD}>操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {banners.map((item) => (
                <tr key={item.id} className={STICKY_TABLE_ROW}>
                  <td className={STICKY_LEFT_CELL}>
                    <div className="relative h-16 w-28 overflow-hidden rounded-lg border border-rose-100 bg-zinc-50">
                      {item.imageUrl ? (
                        isClientImageInvalid(item.imageUrl) ? (
                          <span className="flex h-full items-center justify-center px-1 text-center text-xs text-amber-700">
                            {CMS_IMAGE_REUPLOAD_HINT}
                          </span>
                        ) : resolveClientImagePreview(item.imageUrl) ? (
                        <Image
                          src={resolveClientImagePreview(item.imageUrl)!}
                          alt="轮播图"
                          fill
                          className="object-cover"
                          unoptimized
                        />
                        ) : (
                          <span className="flex h-full items-center justify-center text-xs text-zinc-400">
                            无图
                          </span>
                        )
                      ) : (
                        <span className="flex h-full items-center justify-center text-xs text-zinc-400">
                          无图
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={STICKY_SCROLL_CELL}>
                    <NumberInput
                      integerOnly
                      min={0}
                      allowEmpty
                      commitOnBlur
                      value={item.sortOrder}
                      onChange={(sortOrder) => {
                        if (sortOrder != null) {
                          void handleSortChange(item, sortOrder);
                        }
                      }}
                      inputClassName="w-20 px-2 py-1 text-sm"
                    />
                    <p className="mt-0.5 text-xs text-zinc-400">越小越靠前</p>
                  </td>
                  <td className={STICKY_SCROLL_CELL}>{renderJumpSummary(item)}</td>
                  <td className={STICKY_SCROLL_CELL}>
                    <Badge variant={displayStatusVariant(item.displayStatus)}>
                      {item.displayStatus ?? (item.isActive !== false ? "展示中" : "已停用")}
                    </Badge>
                  </td>
                  <td className={`text-xs text-zinc-500 ${STICKY_SCROLL_CELL}`}>
                    <p>
                      {item.startsAt
                        ? formatUpdatedAt(item.startsAt)
                        : "立即"}
                      {" ~ "}
                      {item.endsAt ? formatUpdatedAt(item.endsAt) : "不限"}
                    </p>
                  </td>
                  <td className={`text-zinc-500 ${STICKY_SCROLL_CELL}`}>
                    {formatUpdatedAt(item.updatedAt)}
                  </td>
                  <td className={STICKY_RIGHT_CELL}>
                    <div className={STICKY_ACTIONS}>
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
                        disabled={deletingId === item.id}
                        onClick={() => void handleDelete(item)}
                      >
                        {deletingId === item.id ? "删除中…" : "删除"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </StickyTableScroll>
        </div>
      )}

      <AdminDrawer
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        title={editingId ? "编辑轮播图" : "新增轮播图"}
        description="配置轮播图与点击后的跳转行为"
        size="md"
        closeOnOverlayClick={false}
        bodyClassName="space-y-3"
        footer={
          <DrawerFooterActions
            onCancel={closeModal}
            onConfirm={() => void handleSave()}
            confirmLoading={uploading || saving}
          />
        }
      >
        {legacyWarning ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {legacyWarning}
          </p>
        ) : null}

        <div className="space-y-3">
              <div>
                <span className="mb-2 block text-sm font-medium text-zinc-700">
                  轮播图 *
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
                    {isClientImageInvalid(form.imageUrl) ? (
                      <p className="mb-2 text-sm text-amber-700">
                        {CMS_IMAGE_REUPLOAD_HINT}
                      </p>
                    ) : resolveClientImagePreview(form.imageUrl) ? (
                    <div className="relative mb-2 h-28 w-full overflow-hidden rounded-xl border border-rose-100">
                      <Image
                        src={resolveClientImagePreview(form.imageUrl)!}
                        alt="预览"
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    ) : null}
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
                    className="flex h-24 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/30 text-sm text-rose-700 hover:border-rose-300"
                  >
                    {uploading ? "上传中…" : "点击上传轮播图（JPG / PNG / WebP）"}
                  </button>
                )}
              </div>

              <NumberInput
                label="排序权重"
                integerOnly
                min={0}
                allowEmpty
                value={form.sortOrder}
                onChange={(sortOrder) => {
                  if (sortOrder != null) {
                    setForm((d) => ({ ...d, sortOrder }));
                  }
                }}
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

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="展示开始（可选）"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) =>
                    setForm((d) => ({ ...d, startsAt: e.target.value }))
                  }
                />
                <Input
                  label="展示结束（可选）"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) =>
                    setForm((d) => ({ ...d, endsAt: e.target.value }))
                  }
                />
              </div>
              <p className="-mt-2 text-xs text-zinc-500">
                留空表示立即可展示 / 不过期；无跳转 Banner 可正常保存。
              </p>

              <CmsLinkTargetSelector
                value={linkTarget}
                onChange={setLinkTarget}
                showCoupon
              />
        </div>
      </AdminDrawer>

      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
