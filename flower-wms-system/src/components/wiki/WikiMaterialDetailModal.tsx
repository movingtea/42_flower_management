"use client";

import type { ReactNode } from "react";
import { WikiCareTable } from "@/components/wiki/WikiCareTable";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { DrawerFooterActions } from "@/components/admin/DrawerFooterActions";
import { formatNullableDateTime } from "@/lib/datetime";
import type { WikiListItem } from "@/lib/wiki-constants";
import { normalizeCareTable, validateCareTableForSave } from "@/lib/wiki-care";

type Props = {
  item: WikiListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function WikiMaterialDetailDrawer({
  item,
  open,
  onOpenChange,
  onEdit,
}: Props) {
  const careTable =
    item.careTable?.length && validateCareTableForSave(item.careTable)
      ? normalizeCareTable(item.careTable)
      : null;

  return (
    <AdminDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={item.chineseName}
      description={item.englishName || "物料详情"}
      size="lg"
      closeOnOverlayClick
      bodyClassName="space-y-4"
      footer={
        <DrawerFooterActions
          onCancel={() => onOpenChange(false)}
          cancelLabel="关闭"
          hideConfirm={!onEdit}
          confirmLabel="编辑"
          onConfirm={onEdit}
        />
      }
    >
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <DetailField
          label="标准成本"
          value={
            item.standardUnitCost
              ? `¥${Number(item.standardUnitCost).toFixed(2)} / ${
                  item.costUnit || "支"
                }`
              : "未设置"
          }
        />
        <DetailField
          label="成本更新时间"
          value={
            item.costUpdatedAt
              ? formatNullableDateTime(item.costUpdatedAt)
              : "—"
          }
        />
        <DetailField
          label="成本备注"
          value={item.costNote?.trim() || "—"}
          className="sm:col-span-2"
        />
      </dl>

      <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        标准成本用于产品定价预估；订单实际成本仍以入库批次成本为准。
      </p>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-700">养护指南</h3>
        {careTable ? (
          <WikiCareTable rows={careTable} />
        ) : (
          <pre className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-relaxed text-zinc-700">
            {item.maintenance?.trim() || "暂无养护说明"}
          </pre>
        )}
      </div>
    </AdminDrawer>
  );
}

/** @deprecated 使用 WikiMaterialDetailDrawer */
export function WikiMaterialDetailModal({
  item,
  onClose,
  onEdit,
}: {
  item: WikiListItem;
  onClose: () => void;
  onEdit?: () => void;
}) {
  return (
    <WikiMaterialDetailDrawer
      item={item}
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onEdit={onEdit}
    />
  );
}
