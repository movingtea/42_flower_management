"use client";

import { useMemo, useState } from "react";
import {
  formatDateInAppTimezoneIso,
  formatDateTimeInAppTimezone,
} from "@/lib/datetime";
import type { BatchPipelineRow } from "@/services/wms-stock";

type MaterialGroup = {
  groupKey: string;
  materialName: string;
  flowerWikiId: string | null;
  rows: BatchPipelineRow[];
  batchCount: number;
  totalQty: number;
  totalValue: number;
  unit: string;
};

function formatTime(iso: string) {
  return formatDateTimeInAppTimezone(iso);
}

function buildGroups(pipeline: BatchPipelineRow[]): MaterialGroup[] {
  const map = new Map<string, MaterialGroup>();

  for (const row of pipeline) {
    const groupKey = row.flowerWikiId ?? row.materialId;
    const existing = map.get(groupKey);
    const unitCost = Number.parseFloat(row.unitCost) || 0;
    const rowValue = row.remainingQty * unitCost;

    if (existing) {
      existing.rows.push(row);
      existing.batchCount += 1;
      existing.totalQty += row.remainingQty;
      existing.totalValue += rowValue;
    } else {
      map.set(groupKey, {
        groupKey,
        materialName: row.materialName,
        flowerWikiId: row.flowerWikiId,
        rows: [row],
        batchCount: 1,
        totalQty: row.remainingQty,
        totalValue: rowValue,
        unit: row.unit,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.materialName.localeCompare(b.materialName, "zh-CN")
  );
}

type Props = {
  pipeline: BatchPipelineRow[];
};

export function BatchPipelinePanel({ pipeline }: Props) {
  const groups = useMemo(() => buildGroups(pipeline), [pipeline]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (pipeline.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-12 text-center text-sm text-zinc-500">
        暂无在库批次，请先在右侧完成采购到货入库
      </p>
    );
  }

  return (
    <div className="max-h-none space-y-3 md:max-h-[calc(100vh-10rem)] md:overflow-y-auto md:pr-1">
      {groups.map((group) => {
        const isOpen = expanded.has(group.groupKey);
        return (
          <div
            key={group.groupKey}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
          >
            <button
              type="button"
              onClick={() => toggleGroup(group.groupKey)}
              aria-expanded={isOpen}
              className="flex w-full flex-col gap-3 p-4 text-left transition-colors hover:bg-zinc-50/80 md:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-lg font-bold text-zinc-900 md:text-xl">
                  {group.materialName}
                </h4>
                <span
                  className={`mt-1 shrink-0 text-zinc-400 transition-transform duration-300 ${
                    isOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden
                >
                  ▼
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">
                  共有 {group.batchCount} 个库存批次
                </span>
                <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                  库中总计：{group.totalQty} {group.unit}
                </span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                  库存总价值：¥{group.totalValue.toFixed(2)}
                </span>
              </div>
            </button>

            <div
              className={`grid transition-all duration-300 ease-in-out ${
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <ul className="space-y-2 border-t border-zinc-100 px-4 pb-4 pt-2 md:px-5">
                  {group.rows
                    .slice()
                    .sort(
                      (a, b) =>
                        new Date(a.createdAt).getTime() -
                        new Date(b.createdAt).getTime()
                    )
                    .map((row) => (
                      <li
                        key={row.batchId}
                        className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-3 md:p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-zinc-800">
                              {row.batchNo ?? "无批次号"}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              入库 {formatTime(row.createdAt)}
                              {row.supplier ? ` · ${row.supplier}` : ""}
                            </p>
                          </div>
                          <p className="text-sm">
                            <span className="font-semibold text-rose-700">
                              {row.remainingQty}
                            </span>
                            <span className="text-zinc-500">
                              {" / "}
                              {row.originalQty} {row.unit}
                            </span>
                          </p>
                        </div>
                        <p className="mt-2 text-xs text-zinc-500">
                          进价 ¥{row.unitCost} / {row.unit}
                          {row.expiresAt
                            ? ` · 到期 ${formatDateInAppTimezoneIso(row.expiresAt)}`
                            : ""}
                        </p>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
