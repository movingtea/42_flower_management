import Link from "next/link";
import { StatusBadge, button } from "../_components/V2Ui";
import {
  canConfirmOrder,
  canFinishProduction,
  canStartProduction,
  canCompleteDelivery,
  commercialStateLabel,
  formatCents,
  formatOrderDate,
  fulfillmentStateLabel,
  orderTotalCents,
  productionStateLabel,
  supplyStateLabel,
} from "../_lib/order-ui";
import type { OrderBoardOrder } from "./order-query";
import { confirmOrder, finishDelivery, finishProduction, startOrderProduction } from "./actions";

type CapabilityFlags = {
  canManageOrders: boolean;
  canManageProduction: boolean;
  canManageDelivery: boolean;
};

const stateChip = "inline-flex rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-stone-700 ring-1 ring-stone-200";

function toneForStage(stageId: string): "warning" | "info" | "success" | "danger" | "neutral" {
  switch (stageId) {
    case "pending": return "warning";
    case "production": return "info";
    case "in_progress": return "info";
    case "ready": return "success";
    case "delivering": return "warning";
    case "failed": return "danger";
    default: return "neutral";
  }
}

/** Link body: all scan information lives here, with no nested interactive controls. */
function StageCard({ order, stageTitle, stageId }: {
  order: OrderBoardOrder;
  stageTitle: string;
  stageId: string;
}) {
  const latestRevision = order.revisions[0];
  return <>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="break-all text-sm font-bold text-stone-900">{order.number}</p>
        <p className="mt-0.5 text-xs text-stone-500">
          第 {order.version} 版{latestRevision ? ` · 修订 ${latestRevision.number}` : ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-emerald-800">¥{formatCents(orderTotalCents(order))}</p>
        <span className="mt-1 inline-block rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">
          {order.fulfillment?.kind === "PICKUP" ? "自提" : order.fulfillment?.kind === "DELIVERY" ? "配送" : "未安排"}
        </span>
      </div>
    </div>

    <div className="mt-2 rounded-lg bg-amber-50/80 px-2.5 py-2 text-xs text-amber-950">
      <span className="font-medium">交付：{formatOrderDate(order.deliveryAt)}</span>
      <span className="ml-2 text-amber-800">{order.buyerNameSnapshot || "未填写顾客"}</span>
    </div>

    <ul className="mt-2 space-y-0.5 text-xs text-stone-700">
      {order.items.map((item) => (
        <li key={item.id} className="flex justify-between gap-2">
          <span className="min-w-0 truncate">{item.nameSnapshot}</span>
          <span className="shrink-0 text-stone-500">× {item.quantity}</span>
        </li>
      ))}
    </ul>

    <div className="mt-2 flex flex-wrap gap-1">
      <span className={stateChip}>商业 · {commercialStateLabel(order.commercialState)}</span>
      <span className={stateChip}>供应 · {supplyStateLabel(order.supplyState)}</span>
      <span className={stateChip}>制作 · {productionStateLabel(order.productionState)}</span>
      <span className={stateChip}>交付 · {fulfillmentStateLabel(order.fulfillmentState)}</span>
    </div>

    <div className="mt-2">
      <StatusBadge tone={toneForStage(stageId)}>{stageTitle}</StatusBadge>
    </div>
  </>;
}

/**
 * Board card with an independent link body and sibling action forms. Actions never nest
 * inside the link, and their visibility mirrors the same gates used by the drawer.
 */
export function OrderCard({ order, stageTitle, stageId, detailHref, ...capabilities }: {
  order: OrderBoardOrder;
  stageTitle: string;
  stageId: string;
  detailHref: string;
} & CapabilityFlags) {
  // completeDelivery only accepts a started delivery attempt; expose it for pickup
  // orders or delivery orders that actually have an OUT_FOR_DELIVERY attempt.
  const hasOutForDeliveryAttempt = order.fulfillment?.attempts.some(
    (attempt) => attempt.state === "OUT_FOR_DELIVERY",
  ) ?? false;
  const showDeliveryAction = capabilities.canManageDelivery && canCompleteDelivery(order) &&
    (order.fulfillment?.kind === "PICKUP" || hasOutForDeliveryAttempt);
  const showDeliveryPlanning = capabilities.canManageDelivery &&
    order.fulfillment?.kind === "DELIVERY" &&
    order.productionState === "COMPLETED" &&
    (order.fulfillmentState === "WAITING_DELIVERY" || order.fulfillmentState === "FAILED");
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm transition-shadow hover:border-emerald-200 hover:shadow-md">
      <Link
        href={detailHref}
        className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
      >
        <StageCard order={order} stageTitle={stageTitle} stageId={stageId} />
      </Link>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-stone-100 pt-2">
        {capabilities.canManageOrders && canConfirmOrder(order) && (
          <form action={confirmOrder}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className={`${button} px-2.5 py-1.5 text-xs`}>确认并预留</button>
          </form>
        )}
        {capabilities.canManageProduction && canStartProduction(order) && (
          <form action={startOrderProduction}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className={`${button} px-2.5 py-1.5 text-xs`}>开始制作</button>
          </form>
        )}
        {capabilities.canManageProduction && canFinishProduction(order) && (
          <form action={finishProduction}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="rounded-lg border border-emerald-700 px-2.5 py-1.5 text-xs font-medium text-emerald-900">
              制作完成
            </button>
          </form>
        )}
        {showDeliveryPlanning && (
          <Link
            href={detailHref}
            className="rounded-lg border border-amber-700 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50"
          >
            {order.fulfillmentState === "FAILED" ? "处理配送异常" : "配送安排"}
          </Link>
        )}
        {showDeliveryAction && (
          <form action={finishDelivery}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="rounded-lg border border-emerald-700 px-2.5 py-1.5 text-xs font-medium text-emerald-900">
              交付完成
            </button>
          </form>
        )}
      </div>
    </article>
  );
}
