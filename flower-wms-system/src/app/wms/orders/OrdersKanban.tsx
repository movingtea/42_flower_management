"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { OrderKanbanCard } from "@/app/wms/orders/OrderKanbanCard";
import { OrderKanbanCompactCard } from "@/app/wms/orders/OrderKanbanCompactCard";
import {
  columnIndex,
  KANBAN_COLUMNS,
} from "@/app/wms/orders/kanban-config";
import type { DragPayload, KanbanOrder } from "@/app/wms/orders/types";
import {
  KANBAN_ARCHIVE_DISPLAY_LIMIT,
  sliceArchiveColumnOrders,
} from "@/lib/orders/kanban-archive-display";

type Props = {
  initialOrders: KanbanOrder[];
};

function ordersInColumn(orders: KanbanOrder[], columnId: string): KanbanOrder[] {
  const col = KANBAN_COLUMNS.find((c) => c.id === columnId);
  if (!col) return [];
  if (col.isArchive) {
    return orders.filter(
      (o) => o.status === "COMPLETED" || o.status === "CANCELLED"
    );
  }
  return orders.filter((o) => o.status === col.status);
}

export function OrdersKanban({ initialOrders }: Props) {
  const [orders, setOrders] = useState(initialOrders);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [dropHighlight, setDropHighlight] = useState<string | null>(null);
  const [refundModal, setRefundModal] = useState<{
    order: KanbanOrder;
    rollbackStock: boolean;
  } | null>(null);
  const [shipModal, setShipModal] = useState<{
    order: KanbanOrder;
    deliveryInfo: string;
  } | null>(null);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const col of KANBAN_COLUMNS) {
      map[col.id] = ordersInColumn(orders, col.id).length;
    }
    return map;
  }, [orders]);

  const upsertOrder = useCallback((next: KanbanOrder) => {
    setOrders((prev) => {
      const idx = prev.findIndex((o) => o.id === next.id);
      if (idx === -1) return [next, ...prev];
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
  }, []);

  async function postJson<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as {
      success?: boolean;
      error?: string;
      data?: T;
    };
    if (!res.ok || json.success === false) {
      throw new Error(json.error || "操作失败");
    }
    return json.data as T;
  }

  async function patchTransition(
    orderId: string,
    nextStatus: string,
    deliveryInfo?: string
  ) {
    const res = await fetch("/api/admin/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, nextStatus, deliveryInfo }),
    });
    const json = (await res.json()) as {
      success?: boolean;
      error?: string;
    };
    if (!res.ok || json.success === false) {
      throw new Error(json.error || "状态更新失败");
    }
  }

  async function runAction(orderId: string, fn: () => Promise<void>) {
    setLoadingId(orderId);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setLoadingId(null);
      setRefundModal(null);
      setShipModal(null);
    }
  }

  async function syncOrderFromPatch(
    orderId: string,
    nextStatus: string,
    deliveryInfo?: string
  ) {
    await patchTransition(orderId, nextStatus, deliveryInfo);
    const prev = orders.find((o) => o.id === orderId);
    if (!prev) return;
    let status = nextStatus;
    if (nextStatus === "PAID") status = "PAID";
    if (nextStatus === "PRODUCTION") status = "PRODUCTION";
    if (nextStatus === "DELIVERING") status = "DELIVERING";
    if (nextStatus === "COMPLETED") status = "COMPLETED";
    upsertOrder({
      ...prev,
      status,
      statusLabel:
        status === "PAID"
          ? "已支付"
          : status === "PRODUCTION"
            ? "制作中"
            : status === "DELIVERING"
              ? "配送中"
              : status === "COMPLETED"
                ? "已完成"
                : prev.statusLabel,
      deliveryInfo: deliveryInfo ?? prev.deliveryInfo,
    });
  }

  async function handleDrop(targetColumnId: string) {
    setDropHighlight(null);
    if (!dragPayload) return;

    const { orderId, fromColumnId } = dragPayload;
    setDragPayload(null);

    if (fromColumnId === "archive") {
      setError("归档列订单不可拖出");
      return;
    }

    const fromIdx = columnIndex(fromColumnId);
    const toIdx = columnIndex(targetColumnId);
    if (toIdx !== fromIdx + 1) {
      setError("仅允许向右相邻列拖拽流转");
      return;
    }

    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    try {
      setLoadingId(orderId);
      if (fromColumnId === "pending" && targetColumnId === "paid") {
        await syncOrderFromPatch(orderId, "PAID");
      } else if (fromColumnId === "paid" && targetColumnId === "production") {
        await syncOrderFromPatch(orderId, "PRODUCTION");
      } else if (
        fromColumnId === "production" &&
        targetColumnId === "delivering"
      ) {
        setShipModal({ order, deliveryInfo: "" });
        setLoadingId(null);
        return;
      } else if (
        fromColumnId === "delivering" &&
        targetColumnId === "archive"
      ) {
        await syncOrderFromPatch(orderId, "COMPLETED");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "拖拽流转失败");
    } finally {
      setLoadingId(null);
    }
  }

  function handleDragOverColumn(
    e: React.DragEvent,
    columnId: string
  ) {
    e.preventDefault();
    if (!dragPayload) return;

    if (dragPayload.fromColumnId === "archive") {
      e.dataTransfer.dropEffect = "none";
      return;
    }

    const fromIdx = columnIndex(dragPayload.fromColumnId);
    const toIdx = columnIndex(columnId);
    if (toIdx === fromIdx + 1) {
      e.dataTransfer.dropEffect = "move";
      setDropHighlight(columnId);
    } else {
      e.dataTransfer.dropEffect = "none";
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
          <button
            type="button"
            className="ml-3 text-rose-600 underline"
            onClick={() => setError(null)}
          >
            知道了
          </button>
        </p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {KANBAN_COLUMNS.map((column) => {
          const columnOrders = ordersInColumn(orders, column.id);
          const archiveSlice = column.isArchive
            ? sliceArchiveColumnOrders(columnOrders)
            : null;
          const visibleOrders = archiveSlice?.visible ?? columnOrders;
          const isDropTarget = dropHighlight === column.id;

          return (
            <section
              key={column.id}
              className={`flex w-[min(100%,17.5rem)] shrink-0 flex-col rounded-xl border-2 transition-colors ${column.accentClass} ${
                isDropTarget ? "ring-2 ring-rose-400 ring-offset-2" : ""
              }`}
              onDragOver={(e) => handleDragOverColumn(e, column.id)}
              onDragLeave={() => setDropHighlight(null)}
              onDrop={(e) => {
                e.preventDefault();
                void handleDrop(column.id);
              }}
            >
              <header className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-3">
                <h3 className="text-sm font-semibold text-zinc-900">
                  {column.title}
                </h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${column.badgeClass}`}
                >
                  {counts[column.id] ?? 0}
                </span>
              </header>

              <div className="flex max-h-[calc(100vh-11rem)] min-h-[12rem] flex-1 flex-col gap-2 overflow-y-auto p-2">
                {visibleOrders.length === 0 ? (
                  <p className="py-8 text-center text-xs text-zinc-400">
                    暂无订单
                  </p>
                ) : (
                  visibleOrders.map((order) =>
                    column.isArchive ? (
                      <OrderKanbanCompactCard key={order.id} order={order} />
                    ) : (
                      <OrderKanbanCard
                        key={order.id}
                        order={order}
                        column={column}
                        loading={loadingId === order.id}
                        onDragStart={(o, colId) =>
                          setDragPayload({ orderId: o.id, fromColumnId: colId })
                        }
                        onCloseOrder={(o) =>
                          void runAction(o.id, async () => {
                            await postJson<unknown>(
                              `/api/admin/orders/${o.id}/cancel-or-close`
                            );
                            const prev = orders.find((x) => x.id === o.id)!;
                            upsertOrder({
                              ...prev,
                              status: "CANCELLED",
                              cancelSource: "ADMIN",
                              refundAmount: null,
                              statusLabel: "已取消",
                            });
                          })
                        }
                        onStartProduction={(o) =>
                          void runAction(o.id, () =>
                            syncOrderFromPatch(o.id, "PRODUCTION")
                          )
                        }
                        onShip={(o) =>
                          setShipModal({ order: o, deliveryInfo: "" })
                        }
                        onRefund={(o) =>
                          setRefundModal({ order: o, rollbackStock: true })
                        }
                        onMarkCompleted={(o) =>
                          void runAction(o.id, () =>
                            syncOrderFromPatch(o.id, "COMPLETED")
                          )
                        }
                      />
                    )
                  )
                )}
                {archiveSlice && archiveSlice.hiddenCount > 0 ? (
                  <div className="border-t border-zinc-200/80 px-1 pt-2 text-center text-xs text-zinc-500">
                    <p>仅显示最近 {KANBAN_ARCHIVE_DISPLAY_LIMIT} 单</p>
                    <p className="mt-0.5 text-zinc-400">
                      更多历史订单请在经营报表中查看
                    </p>
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {shipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">发货配送</h3>
            <p className="mt-1 text-sm text-zinc-500">
              订单 {shipModal.order.orderNo}
            </p>
            <label className="mt-4 block text-sm text-zinc-700">
              配送单号 / 配送员电话
              <input
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                value={shipModal.deliveryInfo}
                onChange={(e) =>
                  setShipModal((m) =>
                    m ? { ...m, deliveryInfo: e.target.value } : m
                  )
                }
                placeholder="例如：顺丰 SF1234567890"
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShipModal(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={loadingId === shipModal.order.id}
                onClick={() =>
                  void runAction(shipModal.order.id, () =>
                    syncOrderFromPatch(
                      shipModal.order.id,
                      "DELIVERING",
                      shipModal.deliveryInfo
                    )
                  )
                }
              >
                确认发货
              </Button>
            </div>
          </div>
        </div>
      )}

      {refundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">退款并取消</h3>
            <p className="mt-2 text-sm text-zinc-600">
              订单 {refundModal.order.orderNo}，实付 ¥{refundModal.order.payAmount}
            </p>
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={refundModal.rollbackStock}
                onChange={(e) =>
                  setRefundModal((m) =>
                    m ? { ...m, rollbackStock: e.target.checked } : m
                  )
                }
              />
              花材未损耗，退回 SKU 可售库存
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRefundModal(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                className="bg-rose-700 hover:bg-rose-800"
                disabled={loadingId === refundModal.order.id}
                onClick={() =>
                  void runAction(refundModal.order.id, async () => {
                    const data = await postJson<{
                      order: {
                        refundAmount?: number;
                      };
                    }>(`/api/admin/orders/${refundModal.order.id}/refund`, {
                      rollbackStock: refundModal.rollbackStock,
                    });
                    const prev = orders.find(
                      (x) => x.id === refundModal.order.id
                    )!;
                    upsertOrder({
                      ...prev,
                      status: "CANCELLED",
                      cancelSource: "REFUND",
                      refundAmount:
                        data.order?.refundAmount ?? Number(prev.payAmount),
                      statusLabel: "已取消",
                    });
                  })
                }
              >
                确认退款
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
