"use client";

import { useCallback, useEffect, useState } from "react";
import { ActionEmptyState } from "@/components/admin/ActionEmptyState";
import { RecommendationSlotPicker } from "@/components/cms/pickers/RecommendationSlotPicker";
import type { RecommendationSlotPickerItem } from "@/components/cms/pickers/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/NumberInput";
import { Switch } from "@/components/ui/Switch";
import {
  CMS_HOME_SCENE_ICON_KEYS,
  CMS_HOME_SCENE_TYPE_OPTIONS,
  HOME_SCENE_ENTRY_TARGET_TYPE_LABELS,
} from "@/services/cms-home-scene-entries-pure";
import { HomeSceneEntryTargetType } from "@/generated/prisma/enums";

type EntryRow = {
  id: string;
  title: string;
  subtitle: string | null;
  sceneType: string;
  iconKey: string;
  sortOrder: number;
  isActive: boolean;
  targetType: string;
  targetValue: string | null;
  linkedRecommendationSlotId: string | null;
  linkedRecommendationSlotKey: string | null;
  note: string | null;
  linkedRecommendationSlot: {
    id: string;
    key: string;
    name: string;
    isActive: boolean;
  } | null;
};

type EntryForm = {
  title: string;
  subtitle: string;
  sceneType: string;
  iconKey: string;
  sortOrder: number;
  isActive: boolean;
  targetType: HomeSceneEntryTargetType;
  targetValue: string;
  linkedRecommendationSlotId: string | null;
  linkedRecommendationSlotKey: string | null;
  note: string;
};

const EMPTY_FORM: EntryForm = {
  title: "",
  subtitle: "",
  sceneType: CMS_HOME_SCENE_TYPE_OPTIONS[0]?.value ?? "BIRTHDAY",
  iconKey: CMS_HOME_SCENE_TYPE_OPTIONS[0]?.defaultIconKey ?? "birthday",
  sortOrder: 0,
  isActive: true,
  targetType: HomeSceneEntryTargetType.PRODUCT_FILTER,
  targetValue: "",
  linkedRecommendationSlotId: null,
  linkedRecommendationSlotKey: null,
  note: "",
};

function sceneTypeLabel(value: string): string {
  return (
    CMS_HOME_SCENE_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value
  );
}

function formFromRow(row: EntryRow): EntryForm {
  return {
    title: row.title,
    subtitle: row.subtitle ?? "",
    sceneType: row.sceneType,
    iconKey: row.iconKey,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    targetType: row.targetType as HomeSceneEntryTargetType,
    targetValue: row.targetValue ?? "",
    linkedRecommendationSlotId: row.linkedRecommendationSlotId,
    linkedRecommendationSlotKey: row.linkedRecommendationSlotKey,
    note: row.note ?? "",
  };
}

export function HomeSceneEntriesManager() {
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<EntryForm>(EMPTY_FORM);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        "/api/admin/cms/home-scene-entries?includeInactive=true"
      );
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { entries?: EntryRow[]; warnings?: string[] };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "加载失败");
      }
      setEntries(json.data?.entries ?? []);
      setWarnings(json.data?.warnings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  function openCreate() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      sortOrder: (entries.length + 1) * 10,
    });
    setFormOpen(true);
  }

  function openEdit(row: EntryRow) {
    setEditingId(row.id);
    setForm(formFromRow(row));
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.title.trim()) {
      showToast("请填写标题");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        sceneType: form.sceneType,
        iconKey: form.iconKey,
        sortOrder: form.sortOrder,
        isActive: form.isActive,
        targetType: form.targetType,
        targetValue:
          form.targetType === HomeSceneEntryTargetType.CUSTOM_URL
            ? form.targetValue.trim() || null
            : form.targetType === HomeSceneEntryTargetType.RECOMMENDATION_SLOT
              ? form.linkedRecommendationSlotKey
              : null,
        linkedRecommendationSlotId: form.linkedRecommendationSlotId,
        linkedRecommendationSlotKey: form.linkedRecommendationSlotKey,
        note: form.note.trim() || null,
      };

      const url = editingId
        ? `/api/admin/cms/home-scene-entries/${editingId}`
        : "/api/admin/cms/home-scene-entries";
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
      closeForm();
      await loadEntries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(row: EntryRow) {
    try {
      const res = await fetch(`/api/admin/cms/home-scene-entries/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "操作失败");
      }
      await loadEntries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function handleDelete(row: EntryRow) {
    if (!window.confirm(`确定删除场景入口「${row.title}」？`)) return;
    try {
      const res = await fetch(`/api/admin/cms/home-scene-entries/${row.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "删除失败");
      }
      showToast("已删除");
      await loadEntries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function handleSeedDefaults() {
    const hasExisting = entries.length > 0;
    if (
      hasExisting &&
      !window.confirm(
        "当前已有场景入口，是否继续创建缺失的默认入口？"
      )
    ) {
      return;
    }
    setSeeding(true);
    try {
      const res = await fetch("/api/admin/cms/home-scene-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed-defaults" }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { created?: EntryRow[] };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "初始化失败");
      }
      const count = json.data?.created?.length ?? 0;
      showToast(count ? `已创建 ${count} 个默认入口` : "默认入口均已存在");
      await loadEntries();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "初始化失败");
    } finally {
      setSeeding(false);
    }
  }

  function onSceneTypeChange(sceneType: string) {
    const option = CMS_HOME_SCENE_TYPE_OPTIONS.find((o) => o.value === sceneType);
    setForm((prev) => ({
      ...prev,
      sceneType,
      iconKey: option?.defaultIconKey ?? prev.iconKey,
    }));
  }

  function onSlotChange(
    slotKey: string | null,
    slot?: RecommendationSlotPickerItem | null
  ) {
    setForm((prev) => ({
      ...prev,
      linkedRecommendationSlotKey: slotKey,
      linkedRecommendationSlotId: slot?.id ?? null,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 text-sm text-zinc-600">
        <p className="font-medium text-zinc-800">首页场景入口</p>
        <p className="mt-1">
          决定小程序首页展示哪些送花场景。入口决定用户从哪里进入，推荐位决定该场景展示哪些商品。
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          图标仅影响首页展示，不影响商品筛选。自定义路径仅用于特殊情况。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={openCreate}>
          新建场景入口
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={seeding}
          onClick={() => void handleSeedDefaults()}
        >
          {seeding ? "创建中…" : "使用默认 6 个场景入口"}
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : null}

      {warnings.length ? (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : entries.length === 0 ? (
        <ActionEmptyState
          title="暂无首页场景入口"
          description="小程序会使用默认 6 个场景入口，但建议你在 CMS 中确认展示内容。可点击上方「使用默认 6 个场景入口」或「新建场景入口」。"
          primaryActionLabel="查看试运营准备"
          primaryActionHref="/wms/setup"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-3 py-2 font-medium">标题</th>
                <th className="px-3 py-2 font-medium">副标题</th>
                <th className="px-3 py-2 font-medium">场景类型</th>
                <th className="px-3 py-2 font-medium">图标</th>
                <th className="px-3 py-2 font-medium">排序</th>
                <th className="px-3 py-2 font-medium">启用</th>
                <th className="px-3 py-2 font-medium">跳转方式</th>
                <th className="px-3 py-2 font-medium">关联推荐位</th>
                <th className="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr key={row.id} className="border-t border-zinc-100">
                  <td className="px-3 py-2 font-medium">{row.title}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {row.subtitle ?? "—"}
                  </td>
                  <td className="px-3 py-2">{sceneTypeLabel(row.sceneType)}</td>
                  <td className="px-3 py-2">
                    <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">
                      {row.iconKey}
                    </code>
                  </td>
                  <td className="px-3 py-2">{row.sortOrder}</td>
                  <td className="px-3 py-2">
                    <Badge variant={row.isActive ? "success" : "default"}>
                      {row.isActive ? "启用" : "停用"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {HOME_SCENE_ENTRY_TARGET_TYPE_LABELS[
                      row.targetType as HomeSceneEntryTargetType
                    ] ?? row.targetType}
                  </td>
                  <td className="px-3 py-2">
                    {row.linkedRecommendationSlot ? (
                      row.linkedRecommendationSlot.name
                    ) : row.linkedRecommendationSlotKey ? (
                      <span className="text-amber-700">
                        关联推荐位不存在或已删除
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => openEdit(row)}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void handleToggleActive(row)}
                      >
                        {row.isActive ? "停用" : "启用"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void handleDelete(row)}
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

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">
              {editingId ? "编辑场景入口" : "新建场景入口"}
            </h3>
            <div className="mt-4 space-y-4">
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-zinc-700">标题 *</span>
                <Input
                  value={form.title}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="例如：生日"
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span className="font-medium text-zinc-700">副标题</span>
                <Input
                  value={form.subtitle}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, subtitle: e.target.value }))
                  }
                  placeholder="例如：把祝福做成花"
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span className="font-medium text-zinc-700">场景类型 *</span>
                <select
                  value={form.sceneType}
                  onChange={(e) => onSceneTypeChange(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                >
                  {CMS_HOME_SCENE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.value})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1 text-sm">
                <span className="font-medium text-zinc-700">图标 *</span>
                <select
                  value={form.iconKey}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, iconKey: e.target.value }))
                  }
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                >
                  {CMS_HOME_SCENE_ICON_KEYS.filter((k) => k !== "fallback").map(
                    (key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    )
                  )}
                </select>
                <p className="text-xs text-zinc-500">
                  当前选择：<code>{form.iconKey}</code>
                </p>
              </label>

              <NumberInput
                label="排序"
                integerOnly
                min={0}
                allowEmpty
                value={form.sortOrder}
                onChange={(sortOrder) => {
                  if (sortOrder != null) {
                    setForm((prev) => ({ ...prev, sortOrder }));
                  }
                }}
              />
              <p className="text-xs text-zinc-500">数值越小越靠前</p>

              <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2">
                <span className="text-sm font-medium text-zinc-700">启用</span>
                <Switch
                  checked={form.isActive}
                  onChange={(checked) =>
                    setForm((prev) => ({ ...prev, isActive: checked }))
                  }
                />
              </div>

              <label className="block space-y-1 text-sm">
                <span className="font-medium text-zinc-700">跳转方式</span>
                <select
                  value={form.targetType}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      targetType: e.target.value as HomeSceneEntryTargetType,
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                >
                  {Object.entries(HOME_SCENE_ENTRY_TARGET_TYPE_LABELS).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    )
                  )}
                </select>
              </label>

              {form.targetType ===
              HomeSceneEntryTargetType.RECOMMENDATION_SLOT ? (
                <RecommendationSlotPicker
                  value={form.linkedRecommendationSlotKey}
                  onChange={onSlotChange}
                  label="关联推荐位"
                />
              ) : null}

              {form.targetType === HomeSceneEntryTargetType.CUSTOM_URL ? (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium text-zinc-700">自定义路径</span>
                  <Input
                    value={form.targetValue}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        targetValue: e.target.value,
                      }))
                    }
                    placeholder="/pages/category/category?..."
                  />
                  <p className="text-xs text-amber-700">
                    自定义路径仅用于特殊情况，请确认小程序路径可访问。
                  </p>
                </label>
              ) : null}

              <label className="block space-y-1 text-sm">
                <span className="font-medium text-zinc-700">备注（仅后台）</span>
                <textarea
                  value={form.note}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, note: e.target.value }))
                  }
                  rows={2}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeForm}>
                取消
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
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
