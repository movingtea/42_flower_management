"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useDeferredEffect } from "@/lib/defer-effect";
import { ActionEmptyState } from "@/components/admin/ActionEmptyState";
import { AutoKeyField } from "@/components/cms/pickers/AutoKeyField";
import { ProductPicker } from "@/components/cms/pickers/ProductPicker";
import { SkuPicker } from "@/components/cms/pickers/SkuPicker";
import { RecommendationWarnings } from "@/components/cms/RecommendationWarnings";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/NumberInput";
import {
  generateRecommendationSlotKey,
  validateCmsKey,
} from "@/lib/cms-auto-key";
import { formatDateTimeInAppTimezone } from "@/lib/datetime";
import {
  CMS_OCCASION_TAG_OPTIONS,
  getCmsProductTagLabel,
} from "@/lib/cms-product-tags";
import { evaluateRecommendationItemDisplayStatus } from "@/services/recommendation-display-pure";
import {
  STICKY_LEFT_CELL,
  STICKY_LEFT_HEAD,
  STICKY_RIGHT_CELL,
  STICKY_RIGHT_HEAD,
  STICKY_SCROLL_CELL,
  STICKY_SCROLL_HEAD,
  StickyTableScroll,
} from "@/components/admin/sticky-table";

const SLOT_TYPE_LABELS: Record<string, string> = {
  HOME_MAIN: "首页主推",
  HOME_SECONDARY: "首页次级推荐",
  SCENE: "场景推荐",
  FESTIVAL: "节日推荐",
  NEW_ARRIVAL: "新品上架",
  HIGH_TICKET: "高客单",
  CUSTOM: "自定义",
};

type SlotRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  slotType: string;
  sceneType: string | null;
  isActive: boolean;
  sortOrder: number;
  maxItems: number;
  _count?: { items: number };
  items?: Array<{
    id: string;
    productId: string;
    sortOrder: number;
    product: { name: string; isActive: boolean };
  }>;
};

type SlotDetailItem = {
    id: string;
    productId: string;
    skuId: string | null;
    titleOverride: string | null;
    subtitleOverride: string | null;
    imageOverride: string | null;
    sortOrder: number;
    isActive: boolean;
    startAt: string | null;
    endAt: string | null;
    note: string | null;
    product: {
      id: string;
      name: string;
      isActive: boolean;
      isDeleted?: boolean;
      occasionTags: string[];
      skus?: Array<{
        id: string;
        stock: number;
        imageUrl?: string | null;
        isMainImage?: boolean;
      }>;
    };
    sku: { id: string; specName: string; price: unknown } | null;
};

type SlotDetail = Omit<SlotRow, "items" | "_count"> & {
  items: SlotDetailItem[];
};

type ApiList = { success: boolean; data?: { slots: SlotRow[] }; error?: string };
type ApiSlot = { success: boolean; data?: { slot: SlotDetail }; error?: string };

export function RecommendationSlotsManager() {
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SlotDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [form, setForm] = useState({
    id: "",
    key: "",
    name: "",
    description: "",
    slotType: "HOME_MAIN",
    sceneType: "",
    isActive: true,
    sortOrder: 0 as number | null,
    maxItems: 10 as number | null,
  });
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    productId: "",
    skuId: "",
    titleOverride: "",
    subtitleOverride: "",
    imageOverride: "",
    sortOrder: 0 as number | null,
    isActive: true,
    startAt: "",
    endAt: "",
  });
  const [addWarnings, setAddWarnings] = useState<string[]>([]);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2800);
  };

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/cms/recommendation-slots");
      const json = (await res.json()) as ApiList;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "推荐位数据加载失败，请稍后重试。");
      }
      setSlots(json.data?.slots ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/cms/recommendation-slots/${id}`);
      const json = (await res.json()) as ApiSlot;
      if (!res.ok || !json.success || !json.data?.slot) {
        throw new Error(json.error ?? "加载推荐位详情失败");
      }
      setDetail(json.data.slot);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "加载详情失败");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useDeferredEffect(() => loadSlots(), [loadSlots]);

  useDeferredEffect(() => {
    if (selectedId) return loadDetail(selectedId);
    setDetail(null);
  }, [selectedId, loadDetail]);

  function openCreate() {
    setEditorMode("create");
    setForm({
      id: "",
      key: "",
      name: "",
      description: "",
      slotType: "HOME_MAIN",
      sceneType: "",
      isActive: true,
      sortOrder: 0,
      maxItems: 10,
    });
    setEditorOpen(true);
  }

  function openEdit(slot: SlotRow) {
    setEditorMode("edit");
    setForm({
      id: slot.id,
      key: slot.key,
      name: slot.name,
      description: slot.description ?? "",
      slotType: slot.slotType,
      sceneType: slot.sceneType ?? "",
      isActive: slot.isActive,
      sortOrder: slot.sortOrder,
      maxItems: slot.maxItems,
    });
    setEditorOpen(true);
  }

  const autoSlotKey = generateRecommendationSlotKey({
    slotType: form.slotType,
    sceneType: form.sceneType || null,
    name: form.name,
  });

  const existingKeys = slots.map((s) => s.key);

  async function saveSlot() {
    if (!form.name.trim()) {
      showToast("请填写推荐位名称");
      return;
    }
    const key = (form.key.trim() || autoSlotKey).trim();
    const keyError = validateCmsKey(key);
    if (keyError) {
      showToast(keyError);
      return;
    }
    if (
      existingKeys.some(
        (k) => k === key && (editorMode === "create" || k !== form.key)
      )
    ) {
      showToast("该 key 已被使用，请更换。");
      return;
    }
    if (form.maxItems == null || form.maxItems <= 0) {
      showToast("最大商品数须大于 0");
      return;
    }

    const payload = {
      key,
      name: form.name.trim(),
      description: form.description.trim() || null,
      slotType: form.slotType,
      sceneType: form.sceneType.trim() || null,
      isActive: form.isActive,
      sortOrder: form.sortOrder ?? 0,
      maxItems: form.maxItems,
    };

    const url =
      editorMode === "create"
        ? "/api/admin/cms/recommendation-slots"
        : `/api/admin/cms/recommendation-slots/${form.id}`;
    const method = editorMode === "create" ? "POST" : "PATCH";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) {
      showToast(json.error ?? "保存失败");
      return;
    }

    setEditorOpen(false);
    showToast("推荐位已保存");
    await loadSlots();
    if (form.id) setSelectedId(form.id);
  }

  async function deactivateSlot(id: string) {
    const res = await fetch(`/api/admin/cms/recommendation-slots/${id}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) {
      showToast(json.error ?? "停用失败");
      return;
    }
    showToast("推荐位已停用");
    if (selectedId === id) setSelectedId(null);
    await loadSlots();
  }

  async function addItem() {
    if (!selectedId || !addForm.productId) {
      showToast("请选择商品");
      return;
    }
    setAddWarnings([]);
    const res = await fetch(
      `/api/admin/cms/recommendation-slots/${selectedId}/items`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: addForm.productId,
          skuId: addForm.skuId.trim() || null,
          titleOverride: addForm.titleOverride.trim() || null,
          subtitleOverride: addForm.subtitleOverride.trim() || null,
          imageOverride: addForm.imageOverride.trim() || null,
          sortOrder: Number(addForm.sortOrder) || 0,
          isActive: addForm.isActive,
          startAt: addForm.startAt || null,
          endAt: addForm.endAt || null,
        }),
      }
    );
    const json = (await res.json()) as {
      success: boolean;
      error?: string;
      data?: { warnings?: string[] };
    };
    if (!res.ok || !json.success) {
      showToast(json.error ?? "添加失败");
      return;
    }
    setAddWarnings(json.data?.warnings ?? []);
    setAddOpen(false);
    showToast("商品已添加到推荐位");
    await loadDetail(selectedId);
    await loadSlots();
  }

  async function removeItem(itemId: string) {
    const res = await fetch(`/api/admin/cms/recommendation-items/${itemId}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) {
      showToast(json.error ?? "移除失败");
      return;
    }
    showToast("推荐商品已停用");
    if (selectedId) await loadDetail(selectedId);
    await loadSlots();
  }

  return (
    <div className="space-y-6">
      {toast ? (
        <div className="fixed right-6 top-6 z-50 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">
          用于配置小程序首页和场景入口展示的商品。推荐位为人工配置，系统只提供上架校验和经营风险提示。
        </p>
        <Button type="button" onClick={openCreate}>
          + 新建推荐位
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">正在加载推荐位…</p>
      ) : error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void loadSlots()}
          >
            重试
          </button>
        </div>
      ) : slots.length === 0 ? (
        <ActionEmptyState
          title="暂无推荐位"
          description="小程序首页和场景推荐需要通过推荐位配置展示商品。"
          primaryActionLabel="新建推荐位"
          primaryActionHref="/cms/recommendations"
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <StickyTableScroll minWidth="560px">
              <colgroup>
                <col className="w-48" />
                <col />
                <col />
                <col className="w-36" />
              </colgroup>
              <thead className="border-b bg-zinc-50">
                <tr>
                  <th className={STICKY_LEFT_HEAD}>名称</th>
                  <th className={STICKY_SCROLL_HEAD}>类型</th>
                  <th className={STICKY_SCROLL_HEAD}>商品数</th>
                  <th className={`${STICKY_RIGHT_HEAD} min-w-[8rem] w-36`}>操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {slots.map((slot) => (
                  <tr
                    key={slot.id}
                    className={`group ${
                      selectedId === slot.id ? "bg-rose-50/60" : "hover:bg-zinc-50/50"
                    }`}
                  >
                    <td className={STICKY_LEFT_CELL}>
                      <button
                        type="button"
                        className="text-left font-medium text-zinc-900 hover:text-rose-700"
                        onClick={() => setSelectedId(slot.id)}
                      >
                        {slot.name}
                      </button>
                      <p className="text-xs text-zinc-400" title="内部标识">
                        {slot.key}
                      </p>
                    </td>
                    <td className={STICKY_SCROLL_CELL}>
                      <p>{SLOT_TYPE_LABELS[slot.slotType] ?? slot.slotType}</p>
                      {slot.sceneType ? (
                        <p className="text-xs text-zinc-500">
                          {getCmsProductTagLabel("occasion", slot.sceneType)}
                        </p>
                      ) : null}
                    </td>
                    <td className={STICKY_SCROLL_CELL}>{slot._count?.items ?? 0}</td>
                    <td className={`${STICKY_RIGHT_CELL} min-w-[8rem] w-36`}>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="text-rose-600 hover:underline"
                          onClick={() => openEdit(slot)}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="text-zinc-600 hover:underline"
                          onClick={() => setSelectedId(slot.id)}
                        >
                          商品
                        </button>
                        <button
                          type="button"
                          className="text-red-600 hover:underline"
                          onClick={() => void deactivateSlot(slot.id)}
                        >
                          停用
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </StickyTableScroll>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            {!selectedId ? (
              <p className="text-sm text-zinc-500">选择推荐位查看商品配置</p>
            ) : detailLoading ? (
              <p className="text-sm text-zinc-500">加载中…</p>
            ) : detail ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-zinc-900">
                      {detail.name}
                    </h3>
                    <p className="text-xs text-zinc-500">
                      {SLOT_TYPE_LABELS[detail.slotType]} · 最多 {detail.maxItems}{" "}
                      个
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setAddForm({
                        productId: "",
                        skuId: "",
                        titleOverride: "",
                        subtitleOverride: "",
                        imageOverride: "",
                        sortOrder: (detail.items?.length ?? 0) * 10,
                        isActive: true,
                        startAt: "",
                        endAt: "",
                      });
                      setAddWarnings([]);
                      setAddOpen(true);
                    }}
                  >
                    添加商品
                  </Button>
                </div>

                <RecommendationWarnings warnings={addWarnings} />

                {!detail.items?.length ? (
                  <p className="text-sm text-zinc-500">该推荐位暂无商品。</p>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const evaluations = detail.items.map((item) =>
                        evaluateRecommendationItemDisplayStatus({
                          isActive: item.isActive,
                          startAt: item.startAt,
                          endAt: item.endAt,
                          imageOverride: item.imageOverride,
                          product: {
                            isActive: item.product.isActive,
                            isDeleted: item.product.isDeleted,
                            skus: item.product.skus ?? [],
                          },
                        })
                      );
                      const visibleCount = evaluations.filter(
                        (e) => e.visibleOnMiniprogram
                      ).length;
                      return visibleCount === 0 ? (
                        <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          该推荐位当前没有可在小程序展示的商品。
                        </p>
                      ) : null;
                    })()}
                    {detail.items.map((item) => {
                      const display = evaluateRecommendationItemDisplayStatus({
                        isActive: item.isActive,
                        startAt: item.startAt,
                        endAt: item.endAt,
                        imageOverride: item.imageOverride,
                        product: {
                          isActive: item.product.isActive,
                          isDeleted: item.product.isDeleted,
                          skus: item.product.skus ?? [],
                        },
                      });
                      return (
                      <div
                        key={item.id}
                        className="rounded-lg border border-zinc-100 p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">
                              {item.titleOverride || item.product.name}
                            </p>
                            {item.sku ? (
                              <p className="text-xs text-zinc-500">
                                SKU：{item.sku.specName}
                              </p>
                            ) : null}
                            <div className="mt-1 flex flex-wrap gap-1">
                              <Badge
                                variant={
                                  display.visibleOnMiniprogram
                                    ? "success"
                                    : "warning"
                                }
                              >
                                {display.label}
                              </Badge>
                              {item.product.isActive ? (
                                <Badge variant="success">已上架</Badge>
                              ) : (
                                <Badge variant="warning">未上架</Badge>
                              )}
                              {!item.isActive ? (
                                <Badge variant="default">推荐项已停用</Badge>
                              ) : null}
                            </div>
                            {item.startAt || item.endAt ? (
                              <p className="mt-1 text-xs text-zinc-500">
                                生效：
                                {item.startAt
                                  ? formatDateTimeInAppTimezone(item.startAt)
                                  : "—"}{" "}
                                ~{" "}
                                {item.endAt
                                  ? formatDateTimeInAppTimezone(item.endAt)
                                  : "—"}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex gap-2">
                            <Link
                              href={`/cms/products/${item.productId}`}
                              className="text-rose-600 hover:underline"
                            >
                              编辑商品
                            </Link>
                            <button
                              type="button"
                              className="text-red-600 hover:underline"
                              onClick={() => void removeItem(item.id)}
                            >
                              停用
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {editorOpen ? (
        <Modal title={editorMode === "create" ? "新建推荐位" : "编辑推荐位"} onClose={() => setEditorOpen(false)}>
          <div className="space-y-4">
            <Input label="推荐位名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            {editorMode === "create" ? (
              <AutoKeyField
                value={form.key || autoSlotKey}
                autoValue={autoSlotKey}
                onChange={(key) => setForm({ ...form, key })}
                existingKeys={existingKeys}
                label="推荐位标识"
              />
            ) : (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                <span className="font-mono">{form.key}</span>
                <p className="mt-1 text-xs text-zinc-400">创建后标识不可修改</p>
              </div>
            )}
            <Input label="描述" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">类型</span>
              <select
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                value={form.slotType}
                onChange={(e) => setForm({ ...form, slotType: e.target.value })}
              >
                {Object.entries(SLOT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">关联场景（可选）</span>
              <select
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                value={form.sceneType}
                onChange={(e) => setForm({ ...form, sceneType: e.target.value })}
              >
                <option value="">不关联</option>
                {CMS_OCCASION_TAG_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput
                label="排序"
                integerOnly
                min={0}
                allowEmpty
                value={form.sortOrder}
                onChange={(sortOrder) => {
                  if (sortOrder != null) {
                    setForm({ ...form, sortOrder });
                  }
                }}
              />
              <NumberInput
                label="最大商品数"
                integerOnly
                min={1}
                allowEmpty
                value={form.maxItems}
                onChange={(maxItems) => {
                  if (maxItems != null) {
                    setForm({ ...form, maxItems });
                  }
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              启用
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditorOpen(false)}>取消</Button>
              <Button type="button" onClick={() => void saveSlot()}>保存</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {addOpen && selectedId ? (
        <Modal title="添加推荐商品" onClose={() => setAddOpen(false)}>
          <div className="space-y-4">
            <ProductPicker
              value={addForm.productId || null}
              onChange={(productId) =>
                setAddForm({ ...addForm, productId: productId ?? "", skuId: "" })
              }
            />
            <SkuPicker
              productId={addForm.productId || null}
              value={addForm.skuId || null}
              onChange={(skuId) =>
                setAddForm({ ...addForm, skuId: skuId ?? "" })
              }
            />
            <Input label="覆盖标题" value={addForm.titleOverride} onChange={(e) => setAddForm({ ...addForm, titleOverride: e.target.value })} />
            <Input label="覆盖副标题" value={addForm.subtitleOverride} onChange={(e) => setAddForm({ ...addForm, subtitleOverride: e.target.value })} />
            <Input label="覆盖图片 URL" value={addForm.imageOverride} onChange={(e) => setAddForm({ ...addForm, imageOverride: e.target.value })} />
            <NumberInput
              label="排序"
              integerOnly
              min={0}
              allowEmpty
              value={addForm.sortOrder}
              onChange={(sortOrder) => {
                if (sortOrder != null) {
                  setAddForm({ ...addForm, sortOrder });
                }
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input label="生效开始" type="datetime-local" value={addForm.startAt} onChange={(e) => setAddForm({ ...addForm, startAt: e.target.value })} />
              <Input label="生效结束" type="datetime-local" value={addForm.endAt} onChange={(e) => setAddForm({ ...addForm, endAt: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>取消</Button>
              <Button type="button" onClick={() => void addItem()}>添加</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-zinc-500">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
