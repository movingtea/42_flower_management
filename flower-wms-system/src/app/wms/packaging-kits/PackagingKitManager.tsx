"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { DrawerFooterActions } from "@/components/admin/DrawerFooterActions";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/Switch";
import { formatDateTimeInAppTimezone } from "@/lib/datetime";
import type { PackagingKitRow } from "@/lib/packaging-kit";
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

type Props = {
  initialList: PackagingKitRow[];
};

type FormState = {
  name: string;
  description: string;
  standardCost: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  standardCost: "0.00",
  isActive: true,
};

function formatTime(iso: string) {
  return formatDateTimeInAppTimezone(iso);
}

export function PackagingKitManager({ initialList }: Props) {
  const router = useRouter();
  const [list, setList] = useState(initialList);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2800);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setDrawerOpen(false);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setDrawerOpen(true);
  }

  function startEdit(row: PackagingKitRow) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      description: row.description ?? "",
      standardCost: row.standardCost,
      isActive: row.isActive,
    });
    setDrawerOpen(true);
  }

  async function reloadList() {
    const res = await fetch("/api/admin/wms/packaging-kits");
    const json = (await res.json()) as {
      success: boolean;
      data?: { list?: PackagingKitRow[] };
    };
    if (res.ok && json.success && json.data?.list) {
      setList(json.data.list);
    }
  }

  async function handleSubmit() {
    const name = form.name.trim();
    const standardCost = Number(form.standardCost);
    if (!name) {
      showToast("请填写包装方案名称", "error");
      return;
    }
    if (!Number.isFinite(standardCost) || standardCost < 0) {
      showToast("标准成本须为非负数字", "error");
      return;
    }

    const payload = {
      name,
      description: form.description.trim() || null,
      standardCost: standardCost.toFixed(2),
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      const url = editingId
        ? `/api/admin/wms/packaging-kits/${editingId}`
        : "/api/admin/wms/packaging-kits";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { message?: string };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "保存失败");
      }
      showToast(json.data?.message ?? "保存成功", "success");
      resetForm();
      await reloadList();
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(row: PackagingKitRow) {
    if (!window.confirm(`确定停用包装方案「${row.name}」？`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/wms/packaging-kits/${row.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "停用失败");
      }
      showToast("已停用", "success");
      if (editingId === row.id) resetForm();
      await reloadList();
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "停用失败", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      {toast && (
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
      )}

      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">包装方案管理</h2>
          <p className="mt-1 text-sm text-zinc-500">
            维护订单毛利核算使用的标准包装成本；本阶段不扣减包装耗材库存。
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          新建包装方案
        </Button>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <StickyTableScroll minWidth="720px">
            <colgroup>
              <col className="w-44" />
              <col />
              <col />
              <col />
              <col />
              <col className="w-28" />
            </colgroup>
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className={STICKY_LEFT_HEAD}>名称</th>
                <th className={STICKY_SCROLL_HEAD}>标准成本</th>
                <th className={STICKY_SCROLL_HEAD}>描述</th>
                <th className={STICKY_SCROLL_HEAD}>状态</th>
                <th className={STICKY_SCROLL_HEAD}>更新时间</th>
                <th className={STICKY_RIGHT_HEAD}>操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-zinc-500"
                  >
                    暂无包装方案
                  </td>
                </tr>
              ) : (
                list.map((row) => (
                  <tr key={row.id} className={STICKY_TABLE_ROW}>
                    <td className={STICKY_LEFT_CELL}>{row.name}</td>
                    <td className={`font-semibold text-rose-800 ${STICKY_SCROLL_CELL}`}>
                      ¥{row.standardCost}
                    </td>
                    <td className={`max-w-56 ${STICKY_SCROLL_CELL}`}>
                      {row.description || "—"}
                    </td>
                    <td className={STICKY_SCROLL_CELL}>
                      {row.isActive ? (
                        <Badge variant="success">已启用</Badge>
                      ) : (
                        <Badge variant="default">已停用</Badge>
                      )}
                    </td>
                    <td className={`text-xs text-zinc-500 ${STICKY_SCROLL_CELL}`}>
                      {formatTime(row.updatedAt)}
                    </td>
                    <td className={STICKY_RIGHT_CELL}>
                      <div className={STICKY_ACTIONS}>
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="text-rose-600 hover:underline"
                        >
                          编辑
                        </button>
                        {row.isActive && (
                          <button
                            type="button"
                            onClick={() => handleDeactivate(row)}
                            className="text-zinc-500 hover:text-red-600"
                          >
                            停用
                          </button>
                        )}
                      </div>
                    </td>
                    </tr>
                  ))
                )}
              </tbody>
          </StickyTableScroll>
      </section>

      <AdminDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={editingId ? "编辑包装方案" : "新建包装方案"}
        description="标准成本会乘以订单商品数量计入包装成本"
        size="md"
        closeOnOverlayClick={false}
        bodyClassName="space-y-3"
        footer={
          <DrawerFooterActions
            onCancel={resetForm}
            onConfirm={() => void handleSubmit()}
            confirmLoading={saving}
            confirmLabel={editingId ? "保存修改" : "创建方案"}
          />
        }
      >
            <Input
              label="方案名称"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <Input
              label="标准成本"
              type="number"
              min="0"
              step="0.01"
              value={form.standardCost}
              onChange={(e) =>
                setForm((f) => ({ ...f, standardCost: e.target.value }))
              }
            />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">描述</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              />
            </label>
            <div className="rounded-lg border border-zinc-200 px-3 py-2">
              <Switch
                label="启用状态"
                checked={form.isActive}
                onChange={(checked) =>
                  setForm((f) => ({ ...f, isActive: checked }))
                }
              />
            </div>
      </AdminDrawer>
    </div>
  );
}
