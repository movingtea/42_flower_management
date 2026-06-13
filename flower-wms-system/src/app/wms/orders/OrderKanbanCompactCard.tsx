"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { OrderDetailModal } from "@/app/wms/orders/OrderDetailModal";
import {
  getArchiveCardStyles,
  resolveArchiveVariant,
} from "@/app/wms/orders/archive-semantics";
import type { KanbanOrder } from "@/app/wms/orders/types";
import {
  formatKanbanCompactDate,
  getArchiveCompactStatusLabel,
} from "@/lib/orders/kanban-archive-display";

type Props = {
  order: KanbanOrder;
};

/** 已完成 / 历史归档列：紧凑卡片，点击打开详情 */
export function OrderKanbanCompactCard({ order }: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const variant = resolveArchiveVariant(order);
  const styles = getArchiveCardStyles(variant);
  const dateLabel = formatKanbanCompactDate(order.createdAt, order.deliveryDate);
  const statusLabel = getArchiveCompactStatusLabel(order);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className={`group flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors hover:brightness-[0.98] ${styles.cardClass}`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {order.orderNo}
          </p>
          <p className="mt-0.5 text-xs text-zinc-600">
            ¥{order.payAmount}
            <span className="mx-1 text-zinc-300">·</span>
            {dateLabel}
            <span className="mx-1 text-zinc-300">·</span>
            <span className="font-medium">{statusLabel}</span>
          </p>
        </div>
        <ChevronRight
          className="size-4 shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-600"
          aria-hidden
        />
      </button>

      {isModalOpen && (
        <OrderDetailModal
          orderId={order.id}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}
