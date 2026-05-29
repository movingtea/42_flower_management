"use client";

import { useRef, useState } from "react";
import {
  Calendar,
  ChevronRight,
  MapPin,
  MessageSquare,
  Phone,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyIconButton } from "@/app/wms/orders/CopyIconButton";
import { OrderDetailModal } from "@/app/wms/orders/OrderDetailModal";
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const draggedRef = useRef(false);
  const isArchive = column.isArchive === true;
  const archiveVariant = isArchive ? resolveArchiveVariant(order) : null;
  const archiveStyle = archiveVariant
    ? getArchiveCardStyles(archiveVariant)
    : null;

  const cardClass = isArchive
    ? archiveStyle!.cardClass
    : "border border-rose-100 bg-white shadow-sm";

  function handleCardClick() {
    if (draggedRef.current) return;
    setIsModalOpen(true);
  }

  return (
    <>
      <article
        draggable={!isArchive}
        onDragStart={(e) => {
          if (isArchive) {
            e.preventDefault();
            return;
          }
          draggedRef.current = true;
          e.dataTransfer.effectAllowed = "move";
          onDragStart(order, column.id);
        }}
        onDragEnd={() => {
          window.setTimeout(() => {
            draggedRef.current = false;
          }, 0);
        }}
        onClick={handleCardClick}
        className={`group cursor-pointer rounded-xl p-4 transition-shadow active:cursor-grabbing ${cardClass} ${
          isArchive ? "" : "hover:border-rose-200 hover:shadow-md"
        } ${!isArchive ? "cursor-grab" : ""}`}
      >
        {isArchive && archiveVariant && (
          <span
            className={`mb-2 inline-block rounded-full px-2.5 py-0.5 text-xs ${archiveStyle!.tagClass}`}
          >
            {getArchiveTagLabel(archiveVariant, order)}
          </span>
        )}

        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-0.5">
              <p className="break-all text-sm font-bold text-zinc-900 md:text-base">
                {order.orderNo}
              </p>
              <CopyIconButton text={order.orderNo} label="订单号" />
            </div>
            <p className="text-xs text-zinc-500">{formatTime(order.createdAt)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <p className="text-base font-semibold text-rose-800">
              ¥{order.payAmount}
            </p>
            <ChevronRight
              className="size-4 text-zinc-300 transition-colors group-hover:text-rose-400"
              strokeWidth={2}
              aria-hidden
            />
          </div>
        </div>

        <div className="mb-2 rounded-lg bg-amber-50/90 px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-950">
            <Calendar className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
            配送时间：{order.deliveryDate || "未填写"}
          </p>
          {order.greetingCard ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-sm font-bold text-rose-700">
              <MessageSquare
                className="mt-0.5 size-3.5 shrink-0"
                strokeWidth={2}
                aria-hidden
              />
              <span className="line-clamp-2">贺卡祝词：{order.greetingCard}</span>
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

        <div className="mb-2 space-y-1 text-xs text-zinc-700">
          <p className="flex items-center gap-1.5 font-medium">
            <User
              className="size-3.5 shrink-0 text-zinc-400"
              strokeWidth={2}
              aria-hidden
            />
            {order.receiverName}
          </p>
          <div className="flex items-center gap-0.5">
            <Phone
              className="size-3.5 shrink-0 text-zinc-400"
              strokeWidth={2}
              aria-hidden
            />
            <p className="min-w-0 flex-1 break-all">{order.receiverPhone}</p>
            <CopyIconButton text={order.receiverPhone} label="联系电话" />
          </div>
          <div className="flex items-start gap-0.5">
            <MapPin
              className="mt-0.5 size-3.5 shrink-0 text-zinc-400"
              strokeWidth={2}
              aria-hidden
            />
            <p className="line-clamp-2 min-w-0 flex-1 break-all text-zinc-500">
              {order.deliveryAddress}
            </p>
            <CopyIconButton
              text={order.deliveryAddress}
              label="配送地址"
              className="mt-0.5"
            />
          </div>
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
            onClick={(e) => e.stopPropagation()}
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

      {isModalOpen && (
        <OrderDetailModal
          orderId={order.id}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}
