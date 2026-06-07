"use client";

import type { ReactNode } from "react";
import { WikiCareTable } from "@/components/wiki/WikiCareTable";
import { Button } from "@/components/ui/button";
import type { WikiListItem } from "@/lib/wiki-constants";
import { normalizeCareTable, validateCareTableForSave } from "@/lib/wiki-care";

type Props = {
  item: WikiListItem;
  onClose: () => void;
  onEdit?: () => void;
};

function DetailField({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-relaxed text-zinc-800">{value}</dd>
    </div>
  );
}

export function WikiMaterialDetailModal({ item, onClose, onEdit }: Props) {
  const careTable =
    item.careTable?.length && validateCareTableForSave(item.careTable)
      ? normalizeCareTable(item.careTable)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[min(90vh,760px)] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wiki-detail-title"
      >
        <div className="border-b border-zinc-100 px-6 py-4">
          <p className="text-xs font-medium text-rose-600">物料详情</p>
          <h2
            id="wiki-detail-title"
            className="mt-1 text-xl font-semibold text-zinc-900"
          >
            {item.chineseName}
          </h2>
          {item.englishName && (
            <p className="mt-1 text-sm italic text-zinc-500">{item.englishName}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <DetailField
              label="拉丁学名 / 英文名"
              value={item.englishName || "—"}
              className="sm:col-span-2"
            />
            <DetailField
              label="花语"
              value={item.flowerLanguage?.trim() || "—"}
              className="sm:col-span-2"
            />
            <DetailField
              label="供货周期"
              value={item.supplySeason ?? item.availability ?? "—"}
            />
            <DetailField
              label="默认保质期"
              value={
                item.defaultShelfLifeDays != null
                  ? `${item.defaultShelfLifeDays} 天`
                  : "—"
              }
            />
          </dl>

          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-medium text-zinc-700">养护指南</h3>
            {careTable ? (
              <WikiCareTable rows={careTable} />
            ) : (
              <pre className="whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm leading-relaxed text-zinc-700">
                {item.maintenance?.trim() || "暂无养护说明"}
              </pre>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-100 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            关闭
          </Button>
          {onEdit && (
            <Button type="button" onClick={onEdit}>
              编辑
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
