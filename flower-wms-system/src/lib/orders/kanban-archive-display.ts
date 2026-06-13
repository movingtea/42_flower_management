import type { KanbanOrder } from "@/app/wms/orders/types";
import {
  getArchiveTagLabel,
  resolveArchiveVariant,
} from "@/app/wms/orders/archive-semantics";

export const KANBAN_ARCHIVE_DISPLAY_LIMIT = 20;

/** 折叠卡片日期：优先配送日期，否则下单日期 MM-DD */
export function formatKanbanCompactDate(
  createdAt: string,
  deliveryDate?: string | null
): string {
  const delivery = deliveryDate?.trim();
  if (delivery) {
    const isoMatch = delivery.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[2]}-${isoMatch[3]}`;
    if (/^\d{2}-\d{2}$/.test(delivery)) return delivery;
    if (delivery.length >= 5) return delivery.slice(0, 5);
    return delivery;
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "—";
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export function getArchiveCompactStatusLabel(order: KanbanOrder): string {
  if (order.status === "COMPLETED") return "已完成";
  const variant = resolveArchiveVariant(order);
  return getArchiveTagLabel(variant, order);
}

export function sliceArchiveColumnOrders<T>(
  orders: T[],
  limit = KANBAN_ARCHIVE_DISPLAY_LIMIT
): { visible: T[]; hiddenCount: number; total: number } {
  const total = orders.length;
  if (total <= limit) {
    return { visible: orders, hiddenCount: 0, total };
  }
  return {
    visible: orders.slice(0, limit),
    hiddenCount: total - limit,
    total,
  };
}

export function isArchiveKanbanColumn(columnId: string): boolean {
  return columnId === "archive";
}
