"use client";

import { useState } from "react";
import { Field, button, input } from "../_components/V2Ui";

type Line = { materialId: string; quantity: number };
type Material = { id: string; label: string };
type Initial = {
  id: string;
  code: string;
  name: string;
  notes: string;
  lines: Line[];
};

function initialRows(
  materials: Material[],
  initial: Initial | undefined,
): Line[] {
  if (initial?.lines.length) return initial.lines;
  if (materials.length === 0) return [];
  return [{ materialId: materials[0]!.id, quantity: 1 }];
}

export function PackagingKitEditor({
  action,
  materials,
  initial,
}: {
  action: (data: FormData) => void | Promise<void>;
  materials: Material[];
  initial?: Initial;
}) {
  const [lines, setLines] = useState<Line[]>(() =>
    initialRows(materials, initial),
  );

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
  }

  return (
    <form action={action} className="space-y-4">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <div className="grid gap-3 md:grid-cols-2">
        {initial ? (
          <label className="block text-sm text-stone-700">
            方案编码
            <input
              className={`${input} mt-1 bg-stone-100 text-stone-500`}
              name="code"
              defaultValue={initial.code}
              readOnly
              aria-readonly="true"
            />
            <span className="mt-1 block text-xs text-stone-500">
              编码创建后不能修改
            </span>
          </label>
        ) : (
          <label className="block text-sm text-stone-700">
            方案编码
            <input
              className={`${input} mt-1`}
              name="code"
              placeholder="例如 PKG-GIFT-A"
              required
            />
            <span className="mt-1 block text-xs text-stone-500">
              2–32 位大写字母、数字、点、下划线或短横线
            </span>
          </label>
        )}
        <Field label="方案名称" name="name" defaultValue={initial?.name} />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-stone-700">包装物料</p>
        {lines.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            当前租户还没有可用的包装类物料，请先到物料母表新增包装 / 耗材 / 其他类物料。
          </p>
        ) : (
          lines.map((line, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2 sm:flex-row sm:items-end"
            >
              <label className="min-w-0 flex-1 text-xs text-stone-600">
                物料
                <select
                  className={`${input} mt-1`}
                  value={line.materialId}
                  onChange={(event) =>
                    updateLine(index, { materialId: event.target.value })
                  }
                  required
                >
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.label}
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
                  value={line.quantity}
                  onChange={(event) =>
                    updateLine(index, {
                      quantity: Number(event.target.value),
                    })
                  }
                  required
                />
              </label>
              <button
                type="button"
                className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((current) =>
                    current.filter((_, lineIndex) => lineIndex !== index),
                  )
                }
              >
                删除
              </button>
            </div>
          ))
        )}
        <button
          type="button"
          className="text-sm text-emerald-700"
          disabled={materials.length === 0}
          onClick={() =>
            setLines((current) => [
              ...current,
              { materialId: materials[0]?.id ?? "", quantity: 1 },
            ])
          }
        >
          ＋ 添加物料
        </button>
      </div>

      <label className="block text-sm text-stone-700">
        备注
        <textarea
          className={`${input} mt-1`}
          name="notes"
          rows={2}
          defaultValue={initial?.notes}
          placeholder="例如：开业季标准礼盒组合"
        />
      </label>

      <button
        className={button}
        disabled={materials.length === 0 || lines.length === 0}
      >
        保存包装方案
      </button>
    </form>
  );
}
