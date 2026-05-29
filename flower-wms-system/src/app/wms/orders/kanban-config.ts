import type { KanbanColumnDef } from "@/app/wms/orders/types";

/** 看板列定义（前 4 列为履约池，第 5 列为归档大收拢） */
export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  {
    id: "pending",
    title: "待付款",
    status: "PENDING_PAYMENT",
    accentClass: "border-amber-200 bg-amber-50/90",
    badgeClass: "bg-amber-100 text-amber-900",
  },
  {
    id: "paid",
    title: "待制作",
    status: "PAID",
    accentClass: "border-sky-200 bg-sky-50/90",
    badgeClass: "bg-sky-100 text-sky-900",
  },
  {
    id: "production",
    title: "制作中",
    status: "PRODUCTION",
    accentClass: "border-violet-200 bg-violet-50/90",
    badgeClass: "bg-violet-100 text-violet-900",
  },
  {
    id: "delivering",
    title: "配送中",
    status: "DELIVERING",
    accentClass: "border-orange-200 bg-orange-50/90",
    badgeClass: "bg-orange-100 text-orange-900",
  },
  {
    id: "archive",
    title: "已完成 / 历史归档",
    status: "ARCHIVE",
    accentClass: "border-zinc-300 bg-zinc-100/95",
    badgeClass: "bg-zinc-200 text-zinc-800",
    isArchive: true,
    allowDragOut: false,
  },
];

export const ACTIVE_COLUMN_IDS = [
  "pending",
  "paid",
  "production",
  "delivering",
] as const;

export function columnIndex(columnId: string): number {
  return KANBAN_COLUMNS.findIndex((c) => c.id === columnId);
}
