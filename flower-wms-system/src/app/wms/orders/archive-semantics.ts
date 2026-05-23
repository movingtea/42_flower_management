import type { ArchiveCardVariant, KanbanOrder } from "@/app/wms/orders/types";

/** 归档列卡片语义分类（色彩心理学隔离） */
export function resolveArchiveVariant(order: KanbanOrder): ArchiveCardVariant {
  if (order.status === "COMPLETED") {
    return "completed";
  }

  const refund = order.refundAmount ?? 0;
  if (refund > 0) {
    return "refund_cancel";
  }

  if (order.cancelSource === "ADMIN") {
    return "admin_close";
  }

  return "customer_cancel";
}

export function getArchiveCardStyles(variant: ArchiveCardVariant): {
  cardClass: string;
  tagClass: string;
  label: string;
} {
  switch (variant) {
    case "completed":
      return {
        cardClass:
          "border-2 border-emerald-400 bg-emerald-50 shadow-sm shadow-emerald-100/60",
        tagClass:
          "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 font-semibold",
        label: "真正完成",
      };
    case "customer_cancel":
      return {
        cardClass: "border border-zinc-300 bg-zinc-50",
        tagClass: "bg-zinc-200 text-zinc-700",
        label: "顾客取消",
      };
    case "admin_close":
      return {
        cardClass: "border-2 border-stone-400 bg-stone-50",
        tagClass: "bg-stone-200 text-stone-800 font-medium",
        label: "店长关闭",
      };
    case "refund_cancel":
      return {
        cardClass:
          "border-2 border-rose-400 bg-rose-50 shadow-sm shadow-rose-100/50",
        tagClass: "bg-rose-100 text-rose-800 ring-1 ring-rose-300 font-semibold",
        label: "退款取消",
      };
  }
}

export function getArchiveTagLabel(
  variant: ArchiveCardVariant,
  order: KanbanOrder
): string {
  const base = getArchiveCardStyles(variant).label;
  if (variant === "refund_cancel") {
    const amt = (order.refundAmount ?? 0).toFixed(2);
    return `${base}（已退¥${amt}）`;
  }
  return base;
}
