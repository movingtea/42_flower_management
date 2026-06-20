"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FlowerMaterialSelect } from "@/components/ui/FlowerMaterialSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTodayAppDateString, formatDateInAppTimezoneIso } from "@/lib/datetime";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import {
  buildPurchaseLinePayloadLine,
  createDefaultPurchaseLine,
  DEFAULT_FLOWER_USABLE_RATE_PERCENT,
  inferPurchaseLineItemTypeFromSavedLine,
  insertNewPurchaseLineAtTop,
  isPurchaseLineFieldRequired,
  isPurchaseLineFieldVisible,
  isPurchaseLineReadyForPreview,
  purchaseLineItemTypeLabels,
  PURCHASE_LINE_ITEM_TYPES,
  type PurchaseLineItemType,
  validatePurchaseLineDraft,
} from "@/lib/purchase-line-form-pure";
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
  itemType: PurchaseLineItemType;
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

const purchaseUnits = ["扎", "支", "把", "盒", "件", "卷", "包", "套"];

function todayInputValue() {
  return getTodayAppDateString();
}

function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  const formatted = formatDateInAppTimezoneIso(value);
  return formatted === "—" ? "" : formatted;
}

function resolveWikiUsableRateInput(item: WikiListItem | null): string {
  if (!item) return DEFAULT_FLOWER_USABLE_RATE_PERCENT;
  const rate = item.standardUsableRate ?? item.defaultUsableRate;
  if (!rate) return DEFAULT_FLOWER_USABLE_RATE_PERCENT;
  const numeric = Number(rate);
  if (!Number.isFinite(numeric)) return DEFAULT_FLOWER_USABLE_RATE_PERCENT;
  return String(Math.round(numeric * 1000) / 10);
}

function lineFromOrder(line: PurchaseOrderDetail["lines"][number]): DraftLine {
  const itemType = inferPurchaseLineItemTypeFromSavedLine({
    flowerWikiId: line.flowerWikiId,
    grade: line.grade,
    color: line.color,
    spec: line.spec,
    usableRate: line.usableRate,
  });
  return {
    key: line.id,
    itemType,
    flowerWikiId: line.flowerWikiId,
    flowerName: line.flowerWiki.chineseName,
    purchaseName: line.purchaseName ?? line.flowerWiki.chineseName ?? "",
    grade: line.grade ?? "",
    color: line.color ?? "",
    spec: line.spec ?? "",
    purchaseQuantity: line.purchaseQuantity,
    purchaseUnit: line.purchaseUnit,
    stemsPerUnit: line.stemsPerUnit,
    unitPrice: line.unitPrice,
    usableRate: line.usableRate
      ? String(Number(line.usableRate) * 100)
      : DEFAULT_FLOWER_USABLE_RATE_PERCENT,
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

function FieldLabel({
  children,
  required = false,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <span className="mb-1 block font-medium text-zinc-700">
      {children}
      {required ? <span className="ml-1 text-red-500">*</span> : null}
    </span>
  );
}

function TextareaField({
  label,
  requiredMark = false,
  rows = 2,
  value,
  onChange,
}: {
  label: string;
  requiredMark?: boolean;
  rows?: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <FieldLabel required={requiredMark}>{label}</FieldLabel>
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
    order?.lines.length
      ? [...order.lines].reverse().map(lineFromOrder)
      : [createDefaultPurchaseLine()]
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
      lines: lines.map((line) => buildPurchaseLinePayloadLine(line)),
    }),
    [form, lines]
  );

  const locallyReadyForPreview =
    Boolean(payload.supplierId) &&
    Boolean(payload.purchaseDate) &&
    payload.lines.length > 0 &&
    lines.every((line) => isPurchaseLineReadyForPreview(line));

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

  function changeItemType(key: string, itemType: PurchaseLineItemType) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const defaults = createDefaultPurchaseLine(itemType, line.key);
        return {
          ...defaults,
          purchaseName: line.purchaseName,
          purchaseQuantity: line.purchaseQuantity,
          unitPrice: line.unitPrice,
          note: line.note,
          flowerWikiId: itemType === "FLOWER" ? line.flowerWikiId : "",
          flowerName: itemType === "FLOWER" ? line.flowerName : "",
          grade: itemType === "FLOWER" ? line.grade : "",
          color: itemType === "FLOWER" ? line.color : "",
          spec: itemType === "FLOWER" ? "" : line.spec,
        };
      })
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
      const error = validatePurchaseLineDraft(line, `第 ${index + 1} 行：`);
      if (error) return error;
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

  function addLine() {
    setLines((prev) => insertNewPurchaseLineAtTop(prev, createDefaultPurchaseLine()));
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
          <FieldLabel required>供应商</FieldLabel>
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
          requiredMark
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
            onClick={addLine}
          >
            添加明细
          </Button>
        </div>
        <div className="space-y-4">
          {lines.map((line, index) => {
            const previewLine = displayPreview?.lines[index];
            const show = (field: Parameters<typeof isPurchaseLineFieldVisible>[1]) =>
              isPurchaseLineFieldVisible(line.itemType, field);
            const required = (field: Parameters<typeof isPurchaseLineFieldRequired>[1]) =>
              isPurchaseLineFieldRequired(line.itemType, field);
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
                  {show("itemType") && (
                    <label className="block text-sm">
                      <FieldLabel required={required("itemType")}>采购品类</FieldLabel>
                      <select
                        disabled={!canEdit}
                        value={line.itemType}
                        onChange={(e) =>
                          changeItemType(
                            line.key,
                            e.target.value as PurchaseLineItemType
                          )
                        }
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400 disabled:bg-zinc-50"
                      >
                        {PURCHASE_LINE_ITEM_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {purchaseLineItemTypeLabels[type]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {show("flowerSelect") && (
                    <label className="block text-sm lg:col-span-2">
                      <FieldLabel required={required("flowerSelect")}>花材</FieldLabel>
                      <FlowerMaterialSelect
                        value={line.flowerWikiId || null}
                        disabled={!canEdit}
                        onChange={(item) => selectFlower(line.key, item)}
                      />
                    </label>
                  )}
                  {show("purchaseName") && (
                    <Input
                      label="采购名称"
                      requiredMark={required("purchaseName")}
                      disabled={!canEdit}
                      value={line.purchaseName}
                      onChange={(e) =>
                        updateLine(line.key, { purchaseName: e.target.value })
                      }
                    />
                  )}
                  {show("materialName") && (
                    <Input
                      label="物料名称"
                      requiredMark={required("materialName")}
                      disabled={!canEdit}
                      value={line.purchaseName}
                      onChange={(e) =>
                        updateLine(line.key, { purchaseName: e.target.value })
                      }
                    />
                  )}
                  {show("grade") && (
                    <Input
                      label="等级"
                      disabled={!canEdit}
                      value={line.grade}
                      onChange={(e) => updateLine(line.key, { grade: e.target.value })}
                    />
                  )}
                  {show("color") && (
                    <Input
                      label="颜色"
                      disabled={!canEdit}
                      value={line.color}
                      onChange={(e) => updateLine(line.key, { color: e.target.value })}
                    />
                  )}
                  {show("spec") && (
                    <Input
                      label="规格说明"
                      disabled={!canEdit}
                      value={line.spec}
                      onChange={(e) => updateLine(line.key, { spec: e.target.value })}
                    />
                  )}
                  {show("purchaseQuantity") && (
                    <Input
                      label="采购数量"
                      requiredMark={required("purchaseQuantity")}
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={!canEdit}
                      value={line.purchaseQuantity}
                      onChange={(e) =>
                        updateLine(line.key, { purchaseQuantity: e.target.value })
                      }
                    />
                  )}
                  {show("purchaseUnit") && (
                    <label className="block text-sm">
                      <FieldLabel required={required("purchaseUnit")}>
                        采购单位
                      </FieldLabel>
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
                  )}
                  {show("stemsPerUnit") && (
                    <Input
                      label="每单位支数"
                      requiredMark={required("stemsPerUnit")}
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={!canEdit}
                      value={line.stemsPerUnit}
                      onChange={(e) =>
                        updateLine(line.key, { stemsPerUnit: e.target.value })
                      }
                    />
                  )}
                  {show("unitPrice") && (
                    <Input
                      label="单价"
                      requiredMark={required("unitPrice")}
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={!canEdit}
                      value={line.unitPrice}
                      onChange={(e) =>
                        updateLine(line.key, { unitPrice: e.target.value })
                      }
                    />
                  )}
                  {show("usableRate") && (
                    <Input
                      label="可用率"
                      requiredMark={required("usableRate")}
                      placeholder="如 100、100% 或 1"
                      disabled={!canEdit}
                      value={line.usableRate}
                      onChange={(e) =>
                        updateLine(line.key, { usableRate: e.target.value })
                      }
                    />
                  )}
                  {show("note") && (
                    <Input
                      label="行备注"
                      disabled={!canEdit}
                      value={line.note}
                      onChange={(e) => updateLine(line.key, { note: e.target.value })}
                    />
                  )}
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
                  {show("usableRate") && (
                    <>
                      <span>
                        可用率：
                        {formatPercent(
                          previewLine?.usableRate ??
                            Number(line.usableRate || DEFAULT_FLOWER_USABLE_RATE_PERCENT) /
                              100
                        )}
                      </span>
                      <span>
                        损耗率：{formatPercent(previewLine?.lossRate ?? 0)}
                      </span>
                      <span>
                        损耗后单支成本：¥
                        {Number(previewLine?.lossAdjustedUnitCost ?? 0).toFixed(4)}
                      </span>
                    </>
                  )}
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
