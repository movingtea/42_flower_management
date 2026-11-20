import Link from "next/link";
import {
  StatusBadge,
  V2Table,
  dataTableBody,
  dataTableHead,
  stickyActionCell,
  stickyActionHead,
  type V2Tone,
} from "../_components/V2Ui";
import {
  commercialStateLabel,
  formatCents,
  formatOrderDate,
  fulfillmentStateLabel,
  orderTotalCents,
  productionStateLabel,
  supplyStateLabel,
} from "../_lib/order-ui";
import type { OrderBoardOrder } from "./order-query";

function detailHref(orderId: string, filterQuery: string): string {
  const params = new URLSearchParams(filterQuery);
  params.set("orderId", orderId);
  return `/v2/orders?${params.toString()}`;
}

function commercialTone(state: string): V2Tone {
  if (state === "CONFIRMED") return "success";
  if (state === "PENDING_CONFIRMATION" || state === "PENDING_PAYMENT") return "warning";
  if (state === "CANCELLED") return "danger";
  return "neutral";
}

function supplyTone(state: string): V2Tone {
  if (state === "ON_HAND_COVERED" || state === "INBOUND_COVERED") return "success";
  if (state === "PURCHASE_REQUIRED" || state === "UNFULFILLABLE") return "danger";
  if (state === "SUBSTITUTION_REQUIRED" || state === "PARTIALLY_COVERED") return "warning";
  return "neutral";
}

function productionTone(state: string): V2Tone {
  if (state === "COMPLETED") return "success";
  if (state === "IN_PROGRESS") return "info";
  if (state === "EXCEPTION") return "danger";
  if (state === "READY") return "warning";
  return "neutral";
}

function fulfillmentTone(state: string): V2Tone {
  if (state === "DELIVERED") return "success";
  if (state === "DELIVERING") return "info";
  if (state === "FAILED") return "danger";
  if (state === "WAITING_DELIVERY" || state === "WAITING_PICKUP") return "warning";
  return "neutral";
}

function itemSummary(order: OrderBoardOrder): string {
  const text = order.items
    .map((item) => `${item.nameSnapshot} × ${item.quantity}`)
    .join("、");
  return text || "无商品明细";
}

/**
 * Dense read-only order list. It shares the same `OrderBoardOrder` projection
 * and URL filter contract as the kanban board, so switching views never
 * changes which orders are in scope.
 */
export function OrderList({
  orders,
  filterQuery,
}: {
  orders: OrderBoardOrder[];
  filterQuery: string;
}) {
  if (orders.length === 0) {
    return <div className="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-stone-900">当前筛选下没有订单</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-stone-500">调整关键词、交付日期或履约状态后再试。</p>
    </div>;
  }

  return <V2Table
    label="订单列表"
    fields={["code", "name", "text", "numeric", "status", "action"]}
    minWidthClass="min-w-[62rem]"
  >
    <caption className="sr-only">订单列表</caption>
    <thead className={dataTableHead}>
      <tr>
        <th scope="col" className="px-4 py-3">订单</th>
        <th scope="col" className="px-4 py-3">顾客 / 交付</th>
        <th scope="col" className="px-4 py-3">商品</th>
        <th scope="col" className="px-4 py-3 text-right">金额</th>
        <th scope="col" className="px-4 py-3">履约状态</th>
        <th scope="col" className={stickyActionHead}>操作</th>
      </tr>
    </thead>
    <tbody className={dataTableBody}>
      {orders.map((order) => {
        const href = detailHref(order.id, filterQuery);
        const deliveryKind = order.fulfillment?.kind === "PICKUP"
          ? "自提"
          : order.fulfillment?.kind === "DELIVERY"
            ? "配送"
            : "未安排";
        return <tr key={order.id} className="align-top transition hover:bg-stone-50/70">
          <td className="px-4 py-3">
            <Link href={href} className="whitespace-nowrap font-medium text-stone-900 hover:text-emerald-800">
              {order.number}
            </Link>
            <div className="mt-0.5 whitespace-nowrap text-xs text-stone-500">
              第 {order.version} 版{order.revisions[0] ? ` · 修订 ${order.revisions[0].number}` : ""}
            </div>
          </td>
          <td className="px-4 py-3">
            <p className="text-sm text-stone-900">{order.buyerNameSnapshot || "未填写顾客"}</p>
            <p className="mt-0.5 text-xs text-stone-500">
              {formatOrderDate(order.deliveryAt)} · {deliveryKind}
            </p>
          </td>
          <td className="max-w-[18rem] px-4 py-3 text-xs leading-5 text-stone-600">
            {itemSummary(order)}
          </td>
          <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-stone-900">
            ¥{formatCents(orderTotalCents(order))}
          </td>
          <td className="px-4 py-3">
            <div className="flex max-w-[14rem] flex-wrap gap-1">
              <StatusBadge tone={commercialTone(order.commercialState)}>
                商业 · {commercialStateLabel(order.commercialState)}
              </StatusBadge>
              <StatusBadge tone={supplyTone(order.supplyState)}>
                供应 · {supplyStateLabel(order.supplyState)}
              </StatusBadge>
              <StatusBadge tone={productionTone(order.productionState)}>
                制作 · {productionStateLabel(order.productionState)}
              </StatusBadge>
              <StatusBadge tone={fulfillmentTone(order.fulfillmentState)}>
                交付 · {fulfillmentStateLabel(order.fulfillmentState)}
              </StatusBadge>
            </div>
          </td>
          <td className={stickyActionCell}>
            <Link
              href={href}
              className="inline-flex rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
            >
              查看详情
            </Link>
          </td>
        </tr>;
      })}
    </tbody>
  </V2Table>;
}
