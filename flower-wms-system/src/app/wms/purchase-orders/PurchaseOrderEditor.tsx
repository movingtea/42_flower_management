"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FlowerMaterialSelect } from "@/components/ui/FlowerMaterialSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import type { WikiListItem } from "@/lib/wiki-constants";
import {
  allocationMethodLabels,
  formatQuantity,
  type PurchaseCostAllocationMethod,
  type PurchaseOrderDetail,
  type PurchaseOrderStatus,
  type PurchasePreview,
  type Supplier,
} from "@/app/wms/purchase-orders/types";

type DraftLine = {
  key: string;
  flowerWikiId: string;
  flowerName: string;
  purchaseName: string;
  grade: string;
  color: string;
  spec: string;
  purchaseQuantity: string;
  purchaseUnit: string;
  stemsPerUnit: string;
  unitPrice: string;
  usableRate: string;
  supplierSkuName: string;
  note: string;
};

type FormState = {
  supplierId: string;
  purchaseDate: string;
  expectedArrivalDate: string;
  shippingFee: string;
  packagingFee: string;
  otherFee: string;
  allocationMethod: PurchaseCostAllocationMethod;
  note: string;
};

type Props = {
  suppliers: Supplier[];
  order?: PurchaseOrderDetail | null;
  onSaved: (order: PurchaseOrderDetail) => void;
  onCancel: () => void;
  showToast: (message: string, type: "success" | "error") => void;
};

const purchaseUnits = ["扎", "支", "把", "盒"];

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function toDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function emptyLine(): DraftLine {
  return {
    key: `po-line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    flowerWikiId: "",
    flowerName: "",
    purchaseName: "",
    grade: "",
    color: "",
    spec: "",
    purchaseQuantity: "1",
    purchaseUnit: "扎",
    stemsPerUnit: "10",
    unitPrice: "0",
    usableRate: "",
    supplierSkuName: "",
    note: "",
  };
}

function resolveWikiUsableRateInput(item: WikiListItem | null): string {
  if (!item) return "";
  const rate = item.standardUsableRate ?? item.defaultUsableRate;
  if (!rate) return "";
  const numeric = Number(rate);
  if (!Number.isFinite(numeric)) return "";
  return String(Math.round(numeric * 1000) / 10);
}

function lineFromOrder(line: PurchaseOrderDetail["lines"][number]): DraftLine {
  return {
    key: line.id,
    flowerWikiId: line.flowerWikiId,
    flowerName: line.flowerWiki.chineseName,
    purchaseName: line.purchaseName ?? "",
    grade: line.grade ?? "",
    color: line.color ?? "",
    spec: line.spec ?? "",
    purchaseQuantity: line.purchaseQuantity,
    purchaseUnit: line.purchaseUnit,
    stemsPerUnit: line.stemsPerUnit,
    unitPrice: line.unitPrice,
    usableRate: line.usableRate
      ? String(Number(line.usableRate) * 100)
      : "",
    supplierSkuName: line.supplierSkuName ?? "",
    note: line.note ?? "",
  };
}

function normalizePreview(value: unknown): string {
  if (value === null || value === undefined) return "0";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "toString" in value) return value.toString();
  return "0";
}

function normalizePreviewResult(raw: PurchasePreview): PurchasePreview {
  return {
    goodsAmount: normalizePreview(raw.goodsAmount),
    shippingFee: normalizePreview(raw.shippingFee),
    packagingFee: normalizePreview(raw.packagingFee),
    otherFee: normalizePreview(raw.otherFee),
    totalExtraFee: normalizePreview(raw.totalExtraFee),
    totalAmount: normalizePreview(raw.totalAmount),
    allocationMethod: raw.allocationMethod,
    warnings: raw.warnings ?? [],
    lines: (raw.lines ?? []).map((line) => ({
      ...line,
      purchaseQuantity: normalizePreview(line.purchaseQuantity),
      stemsPerUnit: normalizePreview(line.stemsPerUnit),
      unitPrice: normalizePreview(line.unitPrice),
      totalStems: normalizePreview(line.totalStems),
      lineAmount: normalizePreview(line.lineAmount),
      allocatedExtraFee: normalizePreview(line.allocatedExtraFee),
      actualTotalCost: normalizePreview(line.actualTotalCost),
      actualUnitCost: normalizePreview(line.actualUnitCost),
      usableRate: normalizePreview(line.usableRate),
      lossRate: normalizePreview(line.lossRate),
      lossAdjustedTotalCost: normalizePreview(line.lossAdjustedTotalCost),
      lossAdjustedUnitCost: normalizePreview(line.lossAdjustedUnitCost),
      lossModelExtraCost: normalizePreview(line.lossModelExtraCost),
    })),
  };
}

function buildInitialForm(order?: PurchaseOrderDetail | null): FormState {
  return {
    supplierId: order?.supplierId ?? "",
    purchaseDate: toDateInput(order?.purchaseDate) || todayInputValue(),
    expectedArrivalDate: toDateInput(order?.expectedArrivalDate),
    shippingFee: order?.shippingFee ?? "0",
    packagingFee: order?.packagingFee ?? "0",
    otherFee: order?.otherFee ?? "0",
    allocationMethod: order?.allocationMethod ?? "BY_AMOUNT",
    note: order?.note ?? "",
  };
}

function TextareaField({
  label,
  rows = 2,
  value,
  onChange,
}: {
  label: string;
  rows?: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
      />
    </label>
  );
}

export function PurchaseOrderEditor({
  suppliers,
  order,
  onSaved,
  onCancel,
  showToast,
}: Props) {
  const [form, setForm] = useState<FormState>(() => buildInitialForm(order));
  const [lines, setLines] = useState<DraftLine[]>(() =>
    order?.lines.length ? order.lines.map(lineFromOrder) : [emptyLine()]
  );
  const [preview, setPreview] = useState<PurchasePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);
  const canEdit = !order || order.status === "DRAFT" || order.status === "ORDERED";

  const payload = useMemo(
    () => ({
      supplierId: form.supplierId,
      purchaseDate: form.purchaseDate,
      expectedArrivalDate: form.expectedArrivalDate || null,
      shippingFee: form.shippingFee || "0",
      packagingFee: form.packagingFee || "0",
      otherFee: form.otherFee || "0",
      allocationMethod: form.allocationMethod,
      note: form.note.trim() || null,
      lines: lines.map((line) => ({
        flowerWikiId: line.flowerWikiId,
        purchaseName: line.purchaseName.trim() || null,
        grade: line.grade.trim() || null,
        color: line.color.trim() || null,
        spec: line.spec.trim() || null,
        purchaseQuantity: line.purchaseQuantity || "0",
        purchaseUnit: line.purchaseUnit,
        stemsPerUnit: line.stemsPerUnit || "0",
        unitPrice: line.unitPrice || "0",
        usableRate: line.usableRate.trim() || null,
        supplierSkuName: line.supplierSkuName.trim() || null,
        note: line.note.trim() || null,
      })),
    }),
    [form, lines]
  );

  const locallyReadyForPreview =
    Boolean(payload.supplierId) &&
    Boolean(payload.purchaseDate) &&
    payload.lines.length > 0 &&
    payload.lines.every(
      (line) =>
        line.flowerWikiId &&
        line.purchaseUnit &&
        Number(line.purchaseQuantity) > 0 &&
        Number(line.stemsPerUnit) > 0 &&
        Number(line.unitPrice) >= 0
    );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!locallyReadyForPreview) {
        setPreview(null);
        setPreviewError(null);
        setPreviewLoading(false);
        return;
      }
      setPreviewLoading(true);
      void (async () => {
        try {
          const res = await fetch(
            "/api/admin/wms/purchase-orders/calculate-preview",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }
          );
          const json = (await res.json()) as {
            success?: boolean;
            error?: string;
            data?: PurchasePreview;
          };
          if (!res.ok || !json.success || !json.data) {
            throw new Error(json.error ?? "费用预览计算失败");
          }
          setPreview(normalizePreviewResult(json.data));
          setPreviewError(null);
        } catch (e) {
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : "费用预览计算失败");
        } finally {
          setPreviewLoading(false);
        }
      })();
    }, locallyReadyForPreview ? 320 : 0);
    return () => window.clearTimeout(timer);
  }, [locallyReadyForPreview, payload]);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  function selectFlower(key: string, item: WikiListItem | null) {
    updateLine(key, {
      flowerWikiId: item?.id ?? "",
      flowerName: item?.chineseName ?? "",
      purchaseName: item?.chineseName ?? "",
      usableRate: resolveWikiUsableRateInput(item),
    });
  }

  function validateBeforeSave() {
    if (!form.supplierId) return "请选择供应商";
    if (!form.purchaseDate) return "请选择采购日期";
    if (lines.length === 0) return "请至少添加一条采购明细";
    for (const [index, line] of lines.entries()) {
      const label = `第 ${index + 1} 行`;
      if (!line.flowerWikiId) return `${label}请选择花材`;
      if (!line.purchaseUnit.trim()) return `${label}采购单位不能为空`;
      if (Number(line.purchaseQuantity) <= 0) return `${label}采购数量必须大于 0`;
      if (Number(line.stemsPerUnit) <= 0) return `${label}折算支数必须大于 0`;
      if (Number(line.unitPrice) < 0) return `${label}采购单价不能小于 0`;
    }
    for (const [label, value] of [
      ["运费", form.shippingFee],
      ["包装费", form.packagingFee],
      ["其他费用", form.otherFee],
    ] as const) {
      if (Number(value || 0) < 0) return `${label}不能小于 0`;
    }
    return null;
  }

  async function handleSave(status: Extract<PurchaseOrderStatus, "DRAFT" | "ORDERED">) {
    const error = validateBeforeSave();
    if (error) {
      showToast(error, "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        order
          ? `/api/admin/wms/purchase-orders/${order.id}`
          : "/api/admin/wms/purchase-orders",
        {
          method: order ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, status }),
        }
      );
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { message?: string; purchaseOrder?: PurchaseOrderDetail };
      };
      if (!res.ok || !json.success || !json.data?.purchaseOrder) {
        throw new Error(json.error ?? "保存采购单失败");
      }
      showToast(json.data.message ?? "采购单已保存", "success");
      onSaved(json.data.purchaseOrder);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存采购单失败", "error");
    } finally {
      setSaving(false);
    }
  }

  const displayPreview = preview;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-100 pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900">
            {order ? `编辑采购单 ${order.purchaseNo}` : "新建采购单"}
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            保存时后端会重新计算费用分摊、实际单支成本与损耗后经营成本。
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={onCancel}>
          返回列表
        </Button>
      </div>

      {!canEdit && (
        <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          已到货或已取消采购单不能编辑。
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">供应商</span>
          <select
            value={form.supplierId}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400 disabled:bg-zinc-50"
          >
            <option value="">请选择供应商</option>
            {activeSuppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
            {order?.supplier && !order.supplier.isActive && (
              <option value={order.supplier.id}>{order.supplier.name}（已停用）</option>
            )}
          </select>
          {activeSuppliers.length === 0 && (
            <span className="mt-1 block text-xs text-amber-700">
              请先创建供应商：
              <Link href="/wms/suppliers" className="ml-1 underline">
                前往供应商管理
              </Link>
            </span>
          )}
        </label>
        <Input
          label="采购日期"
          type="date"
          disabled={!canEdit}
          value={form.purchaseDate}
          onChange={(e) =>
            setForm((f) => ({ ...f, purchaseDate: e.target.value }))
          }
        />
        <Input
          label="预计到货日期"
          type="date"
          disabled={!canEdit}
          value={form.expectedArrivalDate}
          onChange={(e) =>
            setForm((f) => ({ ...f, expectedArrivalDate: e.target.value }))
          }
        />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">分摊方式</span>
          <select
            value={form.allocationMethod}
            disabled={!canEdit}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                allocationMethod: e.target.value as PurchaseCostAllocationMethod,
              }))
            }
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400 disabled:bg-zinc-50"
          >
            {Object.entries(allocationMethodLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Input
          label="运费"
          type="number"
          min="0"
          step="0.01"
          disabled={!canEdit}
          value={form.shippingFee}
          onChange={(e) =>
            setForm((f) => ({ ...f, shippingFee: e.target.value }))
          }
        />
        <Input
          label="包装费"
          type="number"
          min="0"
          step="0.01"
          disabled={!canEdit}
          value={form.packagingFee}
          onChange={(e) =>
            setForm((f) => ({ ...f, packagingFee: e.target.value }))
          }
        />
        <Input
          label="其他费用"
          type="number"
          min="0"
          step="0.01"
          disabled={!canEdit}
          value={form.otherFee}
          onChange={(e) => setForm((f) => ({ ...f, otherFee: e.target.value }))}
        />
        <TextareaField
          label="备注"
          value={form.note}
          onChange={(value) => setForm((f) => ({ ...f, note: value }))}
        />
      </div>

      <div className="mt-6">
        <p className="mb-3 text-xs text-zinc-500">
          实际单支成本用于记录采购价格；损耗后单支成本用于经营毛利分析。
        </p>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-semibold text-zinc-900">采购明细</h4>
          <Button
            type="button"
            variant="secondary"
            disabled={!canEdit}
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
          >
            添加明细
          </Button>
        </div>
        <div className="space-y-4">
          {lines.map((line, index) => {
            const previewLine = displayPreview?.lines[index];
            return (
              <div
                key={line.key}
                className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-700">
                    明细 {index + 1}
                  </span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        setLines((prev) => prev.filter((item) => item.key !== line.key))
                      }
                      className="text-sm text-zinc-500 hover:text-red-600 disabled:opacity-40"
                    >
                      删除
                    </button>
                  )}
                </div>
                <div className="grid gap-3 lg:grid-cols-6">
                  <label className="block text-sm lg:col-span-2">
                    <span className="mb-1 block font-medium text-zinc-700">花材</span>
                    <FlowerMaterialSelect
                      value={line.flowerWikiId || null}
                      disabled={!canEdit}
                      onChange={(item) => selectFlower(line.key, item)}
                    />
                  </label>
                  <Input
                    label="采购名称"
                    disabled={!canEdit}
                    value={line.purchaseName}
                    onChange={(e) =>
                      updateLine(line.key, { purchaseName: e.target.value })
                    }
                  />
                  <Input
                    label="等级"
                    disabled={!canEdit}
                    value={line.grade}
                    onChange={(e) => updateLine(line.key, { grade: e.target.value })}
                  />
                  <Input
                    label="颜色"
                    disabled={!canEdit}
                    value={line.color}
                    onChange={(e) => updateLine(line.key, { color: e.target.value })}
                  />
                  <Input
                    label="规格"
                    disabled={!canEdit}
                    value={line.spec}
                    onChange={(e) => updateLine(line.key, { spec: e.target.value })}
                  />
                  <Input
                    label="采购数量"
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!canEdit}
                    value={line.purchaseQuantity}
                    onChange={(e) =>
                      updateLine(line.key, { purchaseQuantity: e.target.value })
                    }
                  />
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-zinc-700">
                      采购单位
                    </span>
                    <select
                      disabled={!canEdit}
                      value={line.purchaseUnit}
                      onChange={(e) =>
                        updateLine(line.key, { purchaseUnit: e.target.value })
                      }
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400 disabled:bg-zinc-50"
                    >
                      {purchaseUnits.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Input
                    label="每单位支数"
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!canEdit}
                    value={line.stemsPerUnit}
                    onChange={(e) =>
                      updateLine(line.key, { stemsPerUnit: e.target.value })
                    }
                  />
                  <Input
                    label="单价"
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!canEdit}
                    value={line.unitPrice}
                    onChange={(e) =>
                      updateLine(line.key, { unitPrice: e.target.value })
                    }
                  />
                  <Input
                    label="可用率"
                    placeholder="如 85、85% 或 0.85"
                    disabled={!canEdit}
                    value={line.usableRate}
                    onChange={(e) =>
                      updateLine(line.key, { usableRate: e.target.value })
                    }
                  />
                  <Input
                    label="供应商品名"
                    disabled={!canEdit}
                    value={line.supplierSkuName}
                    onChange={(e) =>
                      updateLine(line.key, { supplierSkuName: e.target.value })
                    }
                  />
                  <Input
                    label="行备注"
                    disabled={!canEdit}
                    value={line.note}
                    onChange={(e) => updateLine(line.key, { note: e.target.value })}
                  />
                </div>
                <div className="mt-3 grid gap-2 rounded-lg bg-white p-3 text-xs text-zinc-600 md:grid-cols-4 lg:grid-cols-8">
                  <span>总支数：{formatQuantity(previewLine?.totalStems ?? 0)}</span>
                  <span>商品小计：{formatCurrency(previewLine?.lineAmount ?? 0)}</span>
                  <span>
                    分摊费用：{formatCurrency(previewLine?.allocatedExtraFee ?? 0)}
                  </span>
                  <span>
                    实际总成本：{formatCurrency(previewLine?.actualTotalCost ?? 0)}
                  </span>
                  <span>
                    实际单支成本：¥
                    {Number(previewLine?.actualUnitCost ?? 0).toFixed(4)}
                  </span>
                  <span>
                    可用率：{formatPercent(previewLine?.usableRate ?? 0.85)}
                  </span>
                  <span>
                    损耗率：{formatPercent(previewLine?.lossRate ?? 0.15)}
                  </span>
                  <span>
                    损耗后单支成本：¥
                    {Number(previewLine?.lossAdjustedUnitCost ?? 0).toFixed(4)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-semibold text-zinc-900">费用分摊预览</h4>
          <span className="text-xs text-zinc-500">
            {previewLoading ? "计算中…" : "保存时以后端计算为准"}
          </span>
        </div>
        {!locallyReadyForPreview && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            请选择供应商、采购日期，并填写有效采购明细后展示费用预览。
          </p>
        )}
        {previewError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {previewError}
          </p>
        )}
        {displayPreview && (
          <>
            <div className="grid gap-3 text-sm md:grid-cols-6">
              <div>
                <p className="text-xs text-zinc-500">商品金额</p>
                <p className="font-semibold">{formatCurrency(displayPreview.goodsAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">运费</p>
                <p className="font-semibold">{formatCurrency(displayPreview.shippingFee)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">包装费</p>
                <p className="font-semibold">
                  {formatCurrency(displayPreview.packagingFee)}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">其他费用</p>
                <p className="font-semibold">{formatCurrency(displayPreview.otherFee)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">附加费用合计</p>
                <p className="font-semibold">
                  {formatCurrency(displayPreview.totalExtraFee)}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">采购总金额</p>
                <p className="font-semibold text-rose-700">
                  {formatCurrency(displayPreview.totalAmount)}
                </p>
              </div>
            </div>
            {displayPreview.warnings.length > 0 && (
              <ul className="mt-3 list-disc rounded-lg bg-amber-50 px-6 py-3 text-sm text-amber-800">
                {displayPreview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={saving || !canEdit}
          onClick={() => handleSave("DRAFT")}
        >
          {saving ? "保存中…" : "保存为草稿"}
        </Button>
        <Button
          type="button"
          disabled={saving || !canEdit}
          onClick={() => handleSave("ORDERED")}
        >
          {saving ? "保存中…" : "保存为已下单"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消返回列表
        </Button>
      </div>
    </section>
  );
}
