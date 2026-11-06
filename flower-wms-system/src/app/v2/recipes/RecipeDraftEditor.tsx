"use client";

import { useState } from "react";
import { button, input } from "../_components/V2Ui";

type Line = { materialId: string; quantity: number };
type Material = {
  id: string;
  label: string;
  baseUnit: string;
  quantityScale: number;
};
type Sku = {
  id: string;
  label: string;
  lines: Line[];
};
type Row = { key: string; materialId: string; quantity: string };

function rowKey(): string {
  return `recipe-line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toRows(lines: Line[], materials: Material[]): Row[] {
  if (lines.length > 0) {
    return lines.map((line, index) => ({
      key: `initial-line-${index}`,
      materialId: line.materialId,
      quantity: String(line.quantity),
    }));
  }
  if (materials.length === 0) return [];
  return [
    {
      key: "initial-line-0",
      materialId: materials[0]!.id,
      quantity: "1",
    },
  ];
}

export function RecipeDraftEditor({
  action,
  materials,
  skus,
  skuId,
  versionId,
  initialLines,
  submitLabel = "保存草稿",
}: {
  action: (data: FormData) => void | Promise<void>;
  materials: Material[];
  skus?: Sku[];
  skuId?: string;
  versionId?: string;
  initialLines: Line[];
  submitLabel?: string;
}) {
  const firstSku = skus?.[0];
  const [selectedSkuId, setSelectedSkuId] = useState(skuId ?? firstSku?.id ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    toRows(initialLines.length > 0 ? initialLines : firstSku?.lines ?? [], materials),
  );

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  function selectSku(nextSkuId: string) {
    setSelectedSkuId(nextSkuId);
    const nextSku = skus?.find((sku) => sku.id === nextSkuId);
    setRows(toRows(nextSku?.lines ?? [], materials));
  }

  const hidden = rows.map((row) => ({
    materialId: row.materialId,
    quantity: Number(row.quantity),
  }));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="skuId" value={selectedSkuId} />
      {versionId && <input type="hidden" name="versionId" value={versionId} />}
      <input type="hidden" name="lines" value={JSON.stringify(hidden)} />

      {skus && (
        <label className="block text-sm text-stone-700">
          SKU
          <select
            className={`${input} mt-1`}
            value={selectedSkuId}
            onChange={(event) => selectSku(event.target.value)}
            required
          >
            {skus.map((sku) => (
              <option key={sku.id} value={sku.id}>
                {sku.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-stone-500">
            没有配方的 SKU 也可以直接创建第一版草稿。
          </span>
        </label>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-stone-700">物料明细</p>
        {materials.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            当前租户还没有物料，请先到物料母表新增物料。
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            至少添加一项物料后保存。
          </p>
        ) : (
          rows.map((row, index) => {
            const material = materials.find(
              (item) => item.id === row.materialId,
            );
            return (
              <div
                key={row.key}
                className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2 sm:flex-row sm:items-end"
              >
                <label className="min-w-0 flex-1 text-xs text-stone-600">
                  物料
                  <select
                    className={`${input} mt-1`}
                    value={row.materialId}
                    onChange={(event) =>
                      updateRow(index, { materialId: event.target.value })
                    }
                    required
                  >
                    {materials.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-stone-600 sm:w-32">
                  用量
                  <input
                    className={`${input} mt-1`}
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={row.quantity}
                    onChange={(event) =>
                      updateRow(index, { quantity: event.target.value })
                    }
                    required
                  />
                </label>
                <p className="pb-2 text-xs text-stone-500 sm:w-24">
                  {material?.baseUnit ?? "—"}
                  <span className="block">
                    {material
                      ? material.quantityScale === 0
                        ? "整数"
                        : `${material.quantityScale} 位小数`
                      : "选择物料"}
                  </span>
                </p>
                <button
                  type="button"
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 hover:bg-red-50"
                  onClick={() =>
                    setRows((current) =>
                      current.filter((_, rowIndex) => rowIndex !== index),
                    )
                  }
                >
                  删除
                </button>
              </div>
            );
          })
        )}
        <button
          type="button"
          className="text-sm text-emerald-700"
          disabled={materials.length === 0}
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                key: rowKey(),
                materialId: materials[0]?.id ?? "",
                quantity: "1",
              },
            ])
          }
        >
          ＋ 添加物料
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className={button}
          disabled={materials.length === 0 || !selectedSkuId}
        >
          {submitLabel}
        </button>
        <span className="text-xs text-stone-500">
          保存后进入配方详情；草稿可继续编辑，发布后不可修改。
        </span>
      </div>
    </form>
  );
}
