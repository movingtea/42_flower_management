"use client";

import { Button } from "@/components/ui/button";
import {
  getArchiveCardStyles,
  getArchiveTagLabel,
  resolveArchiveVariant,
} from "@/app/wms/orders/archive-semantics";
import type { KanbanColumnDef, KanbanOrder } from "@/app/wms/orders/types";

type Props = {
  order: KanbanOrder;
  column: KanbanColumnDef;
  loading: boolean;
  onCloseOrder: (order: KanbanOrder) => void;
  onStartProduction: (order: KanbanOrder) => void;
  onShip: (order: KanbanOrder) => void;
  onRefund: (order: KanbanOrder) => void;
  onMarkCompleted: (order: KanbanOrder) => void;
  onDragStart: (order: KanbanOrder, columnId: string) => void;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrderKanbanCard({
  order,
  column,
  loading,
  onCloseOrder,
  onStartProduction,
  onShip,
  onRefund,
  onMarkCompleted,
  onDragStart,
}: Props) {
  const isArchive = column.isArchive === true;
  const archiveVariant = isArchive ? resolveArchiveVariant(order) : null;
  const archiveStyle = archiveVariant
    ? getArchiveCardStyles(archiveVariant)
    : null;

  const cardClass = isArchive
    ? archiveStyle!.cardClass
    : "border border-rose-100 bg-white shadow-sm";

  return (
    <article
      draggable={!isArchive}
      onDragStart={(e) => {
        if (isArchive) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        onDragStart(order, column.id);
      }}
      className={`cursor-grab rounded-xl p-4 active:cursor-grabbing ${cardClass} ${
        isArchive ? "" : "hover:border-rose-200"
      }`}
    >
      {isArchive && archiveVariant && (
        <span
          className={`mb-2 inline-block rounded-full px-2.5 py-0.5 text-xs ${archiveStyle!.tagClass}`}
        >
          {getArchiveTagLabel(archiveVariant, order)}
        </span>
      )}

      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-zinc-900">{order.orderNo}</p>
          <p className="text-xs text-zinc-500">{formatTime(order.createdAt)}</p>
        </div>
        <p className="shrink-0 text-base font-semibold text-rose-800">
          ¥{order.payAmount}
        </p>
      </div>

      <div className="mb-2 rounded-lg bg-amber-50/90 px-2.5 py-2">
        <p className="text-xs font-medium text-amber-950">
          配送时间：{order.deliveryDate || "未填写"}
        </p>
        {order.greetingCard ? (
          <p className="mt-1.5 text-sm font-bold text-rose-700">
            贺卡祝词：{order.greetingCard}
          </p>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">无贺卡寄语</p>
        )}
        {order.deliveryInfo && (
          <p className="mt-1 text-xs text-zinc-600">
            配送：{order.deliveryInfo}
          </p>
        )}
      </div>

      <div className="mb-2 text-xs text-zinc-700">
        <p className="font-medium">{order.receiverName}</p>
        <p>{order.receiverPhone}</p>
        <p className="line-clamp-2 text-zinc-500">{order.deliveryAddress}</p>
      </div>

      <ul className="mb-3 space-y-0.5 border-t border-black/5 pt-2 text-xs text-zinc-600">
        {order.items.map((line, i) => (
          <li key={`${order.id}-${i}`}>
            {line.label} × {line.quantity}
          </li>
        ))}
      </ul>

      {!isArchive && (
        <div
          className="flex flex-wrap gap-1.5"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {order.status === "PENDING_PAYMENT" && (
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              disabled={loading}
              onClick={() => onCloseOrder(order)}
            >
              关闭订单
            </Button>
          )}
          {order.status === "PAID" && (
            <>
              <Button
                type="button"
                className="px-2 py-1 text-xs"
                disabled={loading}
                onClick={() => onStartProduction(order)}
              >
                开始制作
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                disabled={loading}
                onClick={() => onRefund(order)}
              >
                退款并取消
              </Button>
            </>
          )}
          {order.status === "PRODUCTION" && (
            <>
              <Button
                type="button"
                className="px-2 py-1 text-xs"
                disabled={loading}
                onClick={() => onShip(order)}
              >
                发货配送
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="px-2 py-1 text-xs"
                disabled={loading}
                onClick={() => onRefund(order)}
              >
                退款并取消
              </Button>
            </>
          )}
          {order.status === "DELIVERING" && (
            <Button
              type="button"
              className="px-2 py-1 text-xs"
              disabled={loading}
              onClick={() => onMarkCompleted(order)}
            >
              标记送达
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
