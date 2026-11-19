import Link from "next/link";
import { input } from "../_components/V2Ui";
import {
  describeProgressState,
  formatPurchaseDateTime,
  formatQuantity,
  isEligiblePurchaseLine,
  isLatePurchaseLine,
  materialIdentityLabel,
  purchaseOrderStateLabel,
  sortReplacementMaterialOptions,
  suggestedAllocationQuantity,
  summarizeShortageQuantities,
  toPurchaseReceiptRows,
} from "../_lib/purchase-ui";
import type { MaterialAvailability } from "@/v2/services/material-availability";
import { calculatePurchaseProgress, type PurchaseProgress } from "@/v2/domain/purchase-progress";
import {
  OFFLINE_PAYMENT_OPTIONS,
  PAYMENT_METHOD_LABELS,
  auditSummary,
  canCancelOrder,
  canCloseOrder,
  canCompleteDelivery,
  canConfirmOrder,
  canFinishProduction,
  canRecordActualUsage,
  canReviseOrder,
  canStartProduction,
  commercialStateLabel,
  costKindLabel,
  costStageLabel,
  deliveryAttemptActionFlags,
  deliveryAttemptStateLabel,
  formatAdjustment,
  formatAmount,
  formatCents,
  fulfillmentStateLabel,
  hasCopyValue,
  latestReservedBatchLines,
  orderTotalCents,
  paymentRefundedCents,
  productionStateLabel,
  quantityStep,
  refundablePaymentCents,
  supplyStateLabel,
  toDateTimeLocalValue,
} from "../_lib/order-ui";
import { CopyButton } from "./CopyButton";
import type { OrderAuditEvent, OrderDetailData } from "./order-query";
import {
  cancelOrder, closeOrder, confirmOrder, createDeliveryAttempt, failDeliveryAttempt,
  finishDelivery, finishProduction, finishProductionWithUsage, recordDeliveryActualCost,
  recordOfflinePayment, recordOfflineRefund, rescheduleDeliveryAttempt, reviseOrder,
  startDeliveryAttempt, startOrderProduction,
} from "./actions";
import { allocatePurchaseDemand, substituteOrderMaterial } from "../actions";

export type DrawerMaterial = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  grade: string | null;
  color: string | null;
  specification: string | null;
  baseUnit: string;
  quantityScale: number;
};

export type OpenPurchaseLine = {
  id: string;
  materialId: string;
  material: DrawerMaterial;
  expectedBaseQty: number;
  allocatedQty: number;
  allocatableQty: number;
  progress: PurchaseProgress;
  expectedAt: Date | null;
  purchaseOrderNumber: string;
  label: string;
};

type DrawerProps = {
  order: OrderDetailData | null;
  requestedOrderId: string;
  closeHref: string;
  materials: DrawerMaterial[];
  openPurchaseLines: OpenPurchaseLine[];
  availabilityByNeedBy: Map<number, Map<string, MaterialAvailability>>;
  audits: OrderAuditEvent[];
  canManageOrders: boolean;
  canManageProduction: boolean;
  canManageDelivery: boolean;
  canManagePurchases: boolean;
};

const PAYMENT_STATE_LABELS: Record<string, string> = {
  PENDING: "待处理",
  SUCCEEDED: "成功",
  FAILED: "失败",
  VOIDED: "已作废",
};
const REFUND_STATE_LABELS: Record<string, string> = {
  REQUESTED: "待处理",
  SUCCEEDED: "成功",
  FAILED: "失败",
};

const sectionCard = "rounded-xl border border-stone-200 bg-white p-4 shadow-sm";
const muted = "text-xs text-stone-500";
const stateBadge = "inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-700";

function Section({ title, hint, children }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return <section className={sectionCard}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
      {hint && <p className={muted}>{hint}</p>}
    </div>
    <div className="mt-3 space-y-3">{children}</div>
  </section>;
}

function Payload({ value }: { value: string | null | undefined }) {
  return <span className="break-all text-xs text-stone-500">{value || "—"}</span>;
}

function ProgressSummary({ expectedBaseQty, progress, unit }: {
  expectedBaseQty: number;
  progress: PurchaseProgress;
  unit: string;
}) {
  return <span>
    采购 {formatQuantity(expectedBaseQty)}{unit} · 合格 {formatQuantity(progress.acceptedOriginalQty)}{unit} ·
    降级 {formatQuantity(progress.downgradedQty)}{unit} · 拒收 {formatQuantity(progress.rejectedQty)}{unit} ·
    剩余 {formatQuantity(progress.remainingQty)}{unit}
  </span>;
}

function RejectionList({ rows, unit }: {
  rows: { id: string; quantity: unknown; rejectionReason: string | null; receipt: { receivedAt: Date } }[];
  unit: string;
}) {
  if (rows.length === 0) return null;
  return <div className="text-[11px] text-amber-900">
    <span className="font-medium">拒收记录：</span>
    {rows.map((row) => <span key={row.id} className="ml-1">
      {formatQuantity(row.quantity)}{unit} · {row.rejectionReason || "未填写原因"} · {formatPurchaseDateTime(row.receipt.receivedAt)}；
    </span>)}
  </div>;
}

function deliveryCostNote(order: OrderDetailData, audits: OrderAuditEvent[]): string | null {
  // The audit row preserves the operator's note even when the adjustment falls back to its
  // default reason. Prefer that explicit note, then the latest stored adjustment reason.
  const audit = audits.find((entry) => {
    if (!entry.action.includes("DELIVERY") ||
        (!entry.action.includes("COST") && !entry.action.includes("ACTUAL"))) {
      return false;
    }
    const snapshot = entry.afterSnapshot;
    return typeof snapshot === "object" && snapshot !== null && !Array.isArray(snapshot) &&
      typeof (snapshot as { note?: unknown }).note === "string" &&
      (snapshot as { note: string }).note.trim().length > 0;
  });
  if (audit) {
    const snapshot = audit.afterSnapshot as { note?: string };
    const note = snapshot.note?.trim();
    if (note) return note;
  }
  const adjustment = order.costAdjustments.find((entry) => entry.kind === "DELIVERY" && entry.reason.trim());
  return adjustment?.reason ?? null;
}

/**
 * Right-side server-rendered detail drawer. All business forms post to server actions and
 * the drawer itself remains a link-driven URL state (`?orderId=`), so no Prisma Decimal or
 * large graph has to cross a client boundary.
 */
export function OrderDetailDrawer({
  order,
  requestedOrderId,
  closeHref,
  materials,
  openPurchaseLines,
  availabilityByNeedBy,
  audits,
  canManageOrders,
  canManageProduction,
  canManageDelivery,
  canManagePurchases,
}: DrawerProps) {
  return <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="订单详情">
    <Link href={closeHref} aria-label="关闭订单详情" className="absolute inset-0 bg-stone-950/40" />
    <aside className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col border-l border-stone-200 bg-stone-50 shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-stone-200 bg-white px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">订单详情</p>
          <h2 className="mt-1 break-all text-lg font-semibold text-stone-900">
            {order ? order.number : "订单不存在"}
          </h2>
          {order && <p className="mt-1 text-xs text-stone-500">
            {order.buyerNameSnapshot || "未填写顾客"} · 第 {order.version} 版 · 交付 {formatPurchaseDateTime(order.deliveryAt)}
          </p>}
        </div>
        <Link href={closeHref} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">
          关闭
        </Link>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {!order
          ? <div className="rounded-xl border border-dashed border-stone-300 bg-white px-5 py-10 text-center">
              <p className="text-sm font-medium text-stone-900">订单不存在</p>
              <p className="mt-2 text-sm text-stone-500">未找到订单 {requestedOrderId}，可能已被删除或不存在。</p>
            </div>
          : <OrderDetailBody
              order={order}
              materials={materials}
              openPurchaseLines={openPurchaseLines}
              availabilityByNeedBy={availabilityByNeedBy}
              audits={audits}
              canManageOrders={canManageOrders}
              canManageProduction={canManageProduction}
              canManageDelivery={canManageDelivery}
              canManagePurchases={canManagePurchases}
            />}
      </div>
    </aside>
  </div>;
}

function OrderDetailBody({
  order,
  materials,
  openPurchaseLines,
  availabilityByNeedBy,
  audits,
  canManageOrders,
  canManageProduction,
  canManageDelivery,
  canManagePurchases,
}: Omit<DrawerProps, "requestedOrderId" | "closeHref" | "order"> & { order: OrderDetailData }) {
  const latestRevision = order.revisions[0];
  const revisionNumberById = new Map(order.revisions.map((revision) => [revision.id, revision.number]));
  const requirementCountByRevisionId = new Map<string, number>();
  for (const item of order.items) {
    for (const requirement of item.requirements) {
      requirementCountByRevisionId.set(
        requirement.revisionId,
        (requirementCountByRevisionId.get(requirement.revisionId) ?? 0) + 1,
      );
    }
  }
  const reservedLines = latestReservedBatchLines(order);
  const succeededPayments = order.payments.filter((payment) => payment.state === "SUCCEEDED");
  const refundablePayments = succeededPayments.filter((payment) => refundablePaymentCents(payment) > 0);
  const paidCents = succeededPayments.reduce(
    (sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0,
  );
  const refundedCents = succeededPayments.reduce(
    (sum, payment) => sum + paymentRefundedCents(payment), 0,
  );
  const latestSnapshot = order.costSnapshots[0];
  const snapshotRows: [string, unknown][] = latestSnapshot ? [
    ["收入", latestSnapshot.revenue],
    ["花材", latestSnapshot.materialCost],
    ["包装", latestSnapshot.packagingCost],
    ["耗材", latestSnapshot.consumableCost],
    ["人工", latestSnapshot.laborCost],
    ["配送", latestSnapshot.deliveryCost],
    ["平台", latestSnapshot.platformCost],
    ["损耗", latestSnapshot.attributedLossCost],
  ] : [];
  const costByKind = new Map<string, { total: number; estimated: boolean; stages: Set<string> }>();
  for (const entry of order.costEntries) {
    const row = costByKind.get(entry.kind) ?? { total: 0, estimated: false, stages: new Set<string>() };
    row.total += Number(entry.amount);
    row.estimated ||= entry.estimated;
    row.stages.add(entry.stage);
    costByKind.set(entry.kind, row);
  }
  const snapshotTotal = latestSnapshot
    ? Number(latestSnapshot.materialCost) + Number(latestSnapshot.packagingCost) +
      Number(latestSnapshot.consumableCost) + Number(latestSnapshot.laborCost) +
      Number(latestSnapshot.deliveryCost) + Number(latestSnapshot.platformCost) +
      Number(latestSnapshot.attributedLossCost)
    : null;
  const note = deliveryCostNote(order, audits);
  const deliveryAttempts = order.fulfillment?.attempts ?? [];
  const latestDeliveryAttemptId = deliveryAttempts[deliveryAttempts.length - 1]?.id;
  const hasOutForDeliveryAttempt = deliveryAttempts.some((attempt) => attempt.state === "OUT_FOR_DELIVERY");
  const hasOpenDeliveryAttempt = deliveryAttempts.some((attempt) =>
    attempt.state === "SCHEDULED" || attempt.state === "OUT_FOR_DELIVERY");
  const isDeliveryFulfillment = order.fulfillment?.kind === "DELIVERY";
  const showCreateDeliveryAttempt = canManageDelivery &&
    isDeliveryFulfillment &&
    order.commercialState === "CONFIRMED" &&
    order.productionState === "COMPLETED" &&
    order.fulfillmentState === "WAITING_DELIVERY" &&
    !hasOpenDeliveryAttempt;
  const showDeliveryCost = canManageDelivery &&
    isDeliveryFulfillment &&
    order.commercialState !== "CANCELLED" &&
    deliveryAttempts.length > 0;
  // completeDelivery only accepts a started delivery attempt; a merely scheduled
  // WAITING_DELIVERY order must be started (or rescheduled) first.
  const showFinishDelivery = canManageDelivery && canCompleteDelivery(order) &&
    (order.fulfillment?.kind === "PICKUP" || hasOutForDeliveryAttempt);

  return <>
    <Section title="订单快照" hint={`创建 ${formatPurchaseDateTime(order.createdAt)}`}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className={muted}>订单号</dt>
          <dd className="mt-0.5 flex items-center gap-1 font-medium">
            <span className="break-all">{order.number}</span>
            {hasCopyValue(order.number) && <CopyButton value={order.number} label="订单号" />}
          </dd>
        </div>
        <div>
          <dt className={muted}>顾客</dt>
          <dd className="mt-0.5">
            {order.buyerNameSnapshot || "未填写"}
            {hasCopyValue(order.buyerPhoneSnapshot) && <span className="ml-2 inline-flex items-center gap-1 text-xs text-stone-600">
              {order.buyerPhoneSnapshot}
              <CopyButton value={order.buyerPhoneSnapshot} label="顾客电话" />
            </span>}
          </dd>
        </div>
        <div>
          <dt className={muted}>收件人 / 电话</dt>
          <dd className="mt-0.5">
            {order.recipientNameSnapshot || "与顾客相同"}
            {hasCopyValue(order.recipientPhoneSnapshot) && <span className="ml-2 inline-flex items-center gap-1 text-xs text-stone-600">
              {order.recipientPhoneSnapshot}
              <CopyButton value={order.recipientPhoneSnapshot} label="收件电话" />
            </span>}
          </dd>
        </div>
        <div>
          <dt className={muted}>配送地址</dt>
          <dd className="mt-0.5 flex items-start gap-1">
            <span className="break-all">{order.addressSnapshot || "自提 / 未填写"}</span>
            {hasCopyValue(order.addressSnapshot) && <CopyButton value={order.addressSnapshot} label="配送地址" />}
          </dd>
        </div>
        <div>
          <dt className={muted}>金额</dt>
          <dd className="mt-0.5 font-semibold text-emerald-800">
            ¥{formatCents(orderTotalCents(order))}
            <span className="ml-2 text-xs font-normal text-stone-500">
              （商品 + 配送费 ¥{formatAmount(order.fulfillment?.deliveryFeeCharged ?? 0)}）
            </span>
          </dd>
        </div>
        <div>
          <dt className={muted}>来源 / 版本</dt>
          <dd className="mt-0.5 text-sm">{order.sourceChannel} · 第 {order.version} 版 · {latestRevision ? `修订 ${latestRevision.number}` : "无修订"}</dd>
        </div>
        <div>
          <dt className={muted}>交付时间</dt>
          <dd className="mt-0.5">{formatPurchaseDateTime(order.deliveryAt)}</dd>
        </div>
        <div>
          <dt className={muted}>贺卡</dt>
          <dd className="mt-0.5 whitespace-pre-wrap">{order.greetingCardSnapshot?.trim() || "无贺卡寄语"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className={muted}>备注 / 最近改单原因</dt>
          <dd className="mt-0.5 text-sm">{latestRevision?.reason || "—"}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <span className={stateBadge}>商业 · {commercialStateLabel(order.commercialState)}</span>
        <span className={stateBadge}>供应 · {supplyStateLabel(order.supplyState)}</span>
        <span className={stateBadge}>制作 · {productionStateLabel(order.productionState)}</span>
        <span className={stateBadge}>交付 · {fulfillmentStateLabel(order.fulfillmentState)}</span>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-3">
        {canManageOrders && canConfirmOrder(order) && <form action={confirmOrder}>
          <input type="hidden" name="orderId" value={order.id} />
          <button className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white">确认并预留</button>
        </form>}
        {canManageProduction && canStartProduction(order) && <form action={startOrderProduction}>
          <input type="hidden" name="orderId" value={order.id} />
          <button className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white">开始制作</button>
        </form>}
        {canManageProduction && canFinishProduction(order) && <form action={finishProduction}>
          <input type="hidden" name="orderId" value={order.id} />
          <button className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-900">制作完成</button>
        </form>}
        {canManageOrders && canCancelOrder(order) && <details className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5">
          <summary className="cursor-pointer text-xs font-medium text-rose-900">取消订单</summary>
          <form action={cancelOrder} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="orderId" value={order.id} />
            <label className="text-[11px] text-stone-600">取消原因<input className={`${input} mt-0.5`} name="reason" /></label>
            <button className="rounded-lg border border-rose-700 px-3 py-2 text-xs font-medium text-rose-900">确认取消</button>
          </form>
        </details>}
        {canManageOrders && canCloseOrder(order) && <details className="rounded-lg border border-stone-300 bg-white px-3 py-1.5">
          <summary className="cursor-pointer text-xs font-medium text-stone-800">关闭订单</summary>
          <form action={closeOrder} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="orderId" value={order.id} />
            <label className="text-[11px] text-stone-600">关闭原因<input className={`${input} mt-0.5`} name="reason" /></label>
            <button className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-medium text-stone-800">确认关闭</button>
          </form>
        </details>}
      </div>
    </Section>

    <Section title="商品与版本" hint={`最新修订 ${latestRevision?.number ?? "—"}`}>
      <div className="space-y-2">
        {order.items.map((item) => {
          const itemRevisionIds = [...new Set(item.requirements.map((requirement) => requirement.revisionId))];
          return <div key={item.id} className="rounded-lg border border-stone-200 bg-stone-50/60 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{item.nameSnapshot} × {item.quantity}</span>
              <span className="text-xs text-stone-600">单价 ¥{formatAmount(item.unitPrice)}</span>
            </div>
            <div className="mt-1 grid gap-1 text-xs text-stone-600 sm:grid-cols-2">
              <div>SKU：{item.sku ? `${item.sku.product.name} / ${item.sku.name}（${item.sku.code}）` : "未绑定 SKU"}</div>
              <div>recipeVersionId：<Payload value={item.recipeVersionId} /></div>
              <div>预留修订：{itemRevisionIds.length > 0
                ? itemRevisionIds.map((id) => `第 ${revisionNumberById.get(id) ?? "?"} 版`).join("、")
                : "无需求记录"}</div>
              <div>商品类型：{item.kind === "STANDARD" ? "标准" : "定制"}</div>
            </div>
          </div>;
        })}
      </div>
      {canManageOrders && canReviseOrder(order) && <details className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-emerald-900">
          改单（数量 / 交付时间，当前第 {latestRevision?.number ?? order.version} 版）
        </summary>
        <form action={reviseOrder} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <input type="hidden" name="orderId" value={order.id} />
          {order.items.map((item) => <label key={item.id} className="block text-xs text-stone-600">
            {item.nameSnapshot} 数量
            <input className={`${input} mt-1`} name={`itemQuantity.${item.id}`} type="number" min="1" step="1" required defaultValue={item.quantity} />
          </label>)}
          <label className="block text-xs text-stone-600">交付时间
            <input className={`${input} mt-1`} name="deliveryAt" type="datetime-local" required defaultValue={toDateTimeLocalValue(order.deliveryAt)} />
          </label>
          <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white">保存修改</button>
        </form>
        <p className="mt-2 text-xs text-stone-500">仅制作开始前可修改；保存后会重新计算预留与缺料状态。</p>
      </details>}
    </Section>

    <Section title="修订历史" hint={latestRevision ? `共 ${order.revisions.length} 版 · 最新第 ${latestRevision.number} 版` : "暂无修订"}>
      {order.revisions.length === 0
        ? <p className="text-sm text-stone-500">暂无修订记录。</p>
        : <ol className="space-y-2">
            {order.revisions.map((revision) => {
              const isLatest = revision.id === latestRevision?.id;
              const requirementCount = requirementCountByRevisionId.get(revision.id) ?? 0;
              return <li
                key={revision.id}
                className={`rounded-lg border p-3 text-sm ${isLatest ? "border-emerald-300 bg-emerald-50/60" : "border-stone-200 bg-stone-50/60"}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-stone-900">
                    第 {revision.number} 版
                    {isLatest && <span className="ml-2 rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-medium text-white">最新</span>}
                  </span>
                  <span className={muted}>{formatPurchaseDateTime(revision.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-stone-700">改单原因：{revision.reason?.trim() || "—"}</p>
                <p className={muted}>需求行 {requirementCount} 条</p>
              </li>;
            })}
          </ol>}
    </Section>

    <Section title="收款与退款历史" hint={`成功收款 ¥${formatCents(paidCents)} · 已退款 ¥${formatCents(refundedCents)}`}>
      {order.payments.length === 0
        ? <p className="text-sm text-stone-500">暂无收款记录。</p>
        : <div className="space-y-2">
            {order.payments.map((payment) => <div key={payment.id} className="rounded-lg border border-stone-200 bg-stone-50/60 p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method} · ¥{formatAmount(payment.amount)}
                </span>
                <span className={stateBadge}>{PAYMENT_STATE_LABELS[payment.state] ?? payment.state}</span>
              </div>
              <p className={muted}>{payment.externalReference ?? "无凭证号"} · {formatPurchaseDateTime(payment.confirmedAt ?? payment.createdAt)}</p>
              {payment.refunds.length > 0 && <div className="mt-2 space-y-1 border-l border-amber-200 pl-2 text-xs text-stone-600">
                {payment.refunds.map((refund) => <div key={refund.id}>
                  退款 ¥{formatAmount(refund.amount)} · {REFUND_STATE_LABELS[refund.state] ?? refund.state} · {refund.reason} · {formatPurchaseDateTime(refund.completedAt ?? refund.createdAt)}
                </div>)}
              </div>}
            </div>)}
          </div>}
      {canManageOrders && order.createdVia === "STAFF_PORTAL" && <details className="rounded-lg border border-stone-200 bg-white p-3">
        <summary className="cursor-pointer text-xs font-medium text-emerald-900">记录线下收款 / 部分退款</summary>
        <form action={recordOfflinePayment} className="mt-2 grid gap-2 sm:grid-cols-[7rem_8rem_1fr_auto] sm:items-end">
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
          <label className="block text-xs text-stone-600">收款金额<input className={`${input} mt-1`} name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label className="block text-xs text-stone-600">收款方式<select className={`${input} mt-1`} name="method">{OFFLINE_PAYMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="block text-xs text-stone-600">凭证 / 备注<input className={`${input} mt-1`} name="externalReference" placeholder="如：收据号、转账尾号" /></label>
          <button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white">记录收款</button>
        </form>
        {refundablePayments.length > 0
          ? <form action={recordOfflineRefund} className="mt-2 grid gap-2 border-t border-stone-200 pt-2 sm:grid-cols-[1fr_7rem_1fr_1fr_auto] sm:items-end">
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
              <label className="block text-xs text-stone-600">原收款<select className={`${input} mt-1`} name="paymentId">{refundablePayments.map((payment) => <option key={payment.id} value={payment.id}>{PAYMENT_METHOD_LABELS[payment.method] ?? payment.method} ¥{formatAmount(payment.amount)} · 可退 ¥{formatCents(refundablePaymentCents(payment))}</option>)}</select></label>
              <label className="block text-xs text-stone-600">退款金额<input className={`${input} mt-1`} name="amount" type="number" min="0.01" step="0.01" required /></label>
              <label className="block text-xs text-stone-600">退款原因<input className={`${input} mt-1`} name="reason" required /></label>
              <label className="block text-xs text-stone-600">退款单号<input className={`${input} mt-1`} name="externalReference" /></label>
              <button className="rounded-lg border border-amber-700 px-3 py-2 text-xs font-medium text-amber-900">记录部分退款</button>
            </form>
          : <p className="mt-2 text-xs text-stone-500">没有可退的成功收款。</p>}
      </details>}
    </Section>

    <Section title="物料需求 / 预留 / 采购进度" hint="仅显示最新修订需求">
      {order.items.flatMap((item) => item.requirements
        .filter((requirement) => requirement.revisionId === latestRevision?.id)
        .map((requirement) => {
          const activeReservations = requirement.reservations.filter((reservation) => reservation.state === "ACTIVE");
          const summary = summarizeShortageQuantities({
            plannedQty: requirement.plannedQty,
            reservedQtys: activeReservations.map((reservation) => reservation.quantity),
            allocatedQtys: requirement.purchaseAllocations.map((allocation) => allocation.allocatedQty),
          });
          const compatibleMaterials = materials.filter((material) =>
            material.id !== requirement.materialId &&
            material.baseUnit === requirement.material.baseUnit);
          const availability = availabilityByNeedBy.get(requirement.needBy.getTime());
          const replacementOptions = sortReplacementMaterialOptions(
            compatibleMaterials.map((material) => ({
              material,
              availableQty: availability?.get(material.id)?.availableQty ?? 0,
            })),
            summary.plannedQty,
          );
          const sameMaterialLines = openPurchaseLines.filter((line) => line.materialId === requirement.materialId);
          const eligibleLines = sameMaterialLines.filter((line) => isEligiblePurchaseLine(line, requirement));
          const lateLines = sameMaterialLines.filter((line) => isLatePurchaseLine(line, requirement));
          const linkedLineIds = new Set(requirement.purchaseAllocations.map((allocation) => allocation.purchaseLineId));
          const unlinkedLines = eligibleLines.filter((line) => !linkedLineIds.has(line.id));
          const step = quantityStep(requirement.material.quantityScale);
          const showAssociation = summary.pendingAssociationQty > 1e-8;
          const suggested = suggestedAllocationQuantity(summary.pendingAssociationQty, unlinkedLines[0]?.allocatableQty ?? 0);

          return <div key={requirement.id} className="space-y-2 rounded-lg border border-stone-200 bg-stone-50/60 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{materialIdentityLabel(requirement.material)}</span>
              <span className="text-xs text-stone-600">第 {revisionNumberById.get(requirement.revisionId) ?? "?"} 版 · 需求最晚 {formatPurchaseDateTime(requirement.needBy)}</span>
            </div>
            <div className="grid gap-1 text-xs text-stone-700 sm:grid-cols-4">
              <span>计划 {formatQuantity(summary.plannedQty)}{requirement.material.baseUnit}</span>
              <span>已预留 {formatQuantity(summary.reservedQty)}{requirement.material.baseUnit}</span>
              <span>采购分配 {formatQuantity(summary.allocatedQty)}{requirement.material.baseUnit}</span>
              <span className={summary.currentShortage > 1e-8 ? "font-medium text-amber-900" : "text-emerald-800"}>
                剩余缺口 {formatQuantity(summary.currentShortage)}{requirement.material.baseUnit}
              </span>
            </div>

            {requirement.reservations.length > 0 && <div className="space-y-0.5 text-[11px] text-stone-600">
              {requirement.reservations.map((reservation) => <div key={reservation.id}>
                批次 {reservation.batch?.batchNo ?? reservation.batchId} · {formatQuantity(reservation.quantity)}{requirement.material.baseUnit} · {reservation.state === "ACTIVE" ? "有效" : reservation.state}
              </div>)}
            </div>}

            {requirement.purchaseAllocations.length > 0 && <div className="space-y-1">
              <p className="text-[11px] font-medium text-stone-700">已关联采购行</p>
              {requirement.purchaseAllocations.map((allocation) => {
                const line = allocation.purchaseLine;
                const expectedBaseQty = line.expectedBaseQty === null || line.expectedBaseQty === undefined
                  ? null
                  : Number(line.expectedBaseQty);
                const progress = expectedBaseQty !== null && expectedBaseQty > 0
                  ? calculatePurchaseProgress(expectedBaseQty, toPurchaseReceiptRows(line.receiptLines))
                  : null;
                const unit = line.material.baseUnit;
                const rejections = line.receiptLines.filter((row) => row.disposition === "REJECTED");
                return <div key={allocation.id} className="rounded border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{line.purchaseOrder.number} · {materialIdentityLabel(line.material)}</span>
                    <span>分配 {formatQuantity(allocation.allocatedQty)}{unit}</span>
                  </div>
                  <div className="text-stone-500">采购单 {purchaseOrderStateLabel(line.purchaseOrder.state)} · 预计到货 {formatPurchaseDateTime(line.purchaseOrder.expectedAt)}</div>
                  {progress && expectedBaseQty !== null
                    ? <>
                        <div><ProgressSummary expectedBaseQty={expectedBaseQty} progress={progress} unit={unit} /></div>
                        <RejectionList rows={rejections} unit={unit} />
                      </>
                    : <div className="text-amber-800">采购行缺少有效基础数量，无法计算补货进度。</div>}
                </div>;
              })}
            </div>}

            {showAssociation && <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-amber-950">关联开放采购明细（待分配 {formatQuantity(summary.pendingAssociationQty)}{requirement.material.baseUnit}）</p>
                {canManagePurchases && <Link
                  className="rounded border border-amber-700 bg-white px-2 py-1 text-[11px] font-medium text-amber-900"
                  href={`/v2/purchases?requirementId=${encodeURIComponent(requirement.id)}`}
                >
                  新建采购单并关联
                </Link>}
              </div>
              {!canManagePurchases
                ? <p className="mt-1 text-[11px] text-stone-500">当前账号无采购关联权限。</p>
                : unlinkedLines.length > 0
                  ? <form action={allocatePurchaseDemand} className="mt-1 grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_6.5rem_auto] sm:items-end">
                      <input type="hidden" name="requirementId" value={requirement.id} />
                      <label className="block text-[11px] text-stone-600">兼容采购明细
                        <select className={`${input} mt-0.5`} name="purchaseLineId" required>
                          {unlinkedLines.map((line) => <option key={line.id} value={line.id}>{line.label}</option>)}
                        </select>
                      </label>
                      <label className="block text-[11px] text-stone-600">分配数量
                        <input className={`${input} mt-0.5`} name="quantity" type="number" min={step} step={step} required defaultValue={Math.min(suggested, unlinkedLines[0].allocatableQty)} />
                      </label>
                      <button className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-medium text-emerald-900">分配采购</button>
                    </form>
                  : eligibleLines.length > 0
                    ? <div className="mt-1 space-y-1 text-[11px] text-stone-600">
                        <p>兼容的开放采购明细均已关联；如仍有缺口，请等待验收、重新采购或人工替换。</p>
                        {eligibleLines.map((line) => <div key={line.id} className="rounded border border-stone-200 bg-white px-2 py-1">
                          {line.purchaseOrderNumber} · 可分配 {formatQuantity(line.allocatableQty)}{line.material.baseUnit} · {describeProgressState(line.progress)}
                          <div className="text-stone-500"><ProgressSummary expectedBaseQty={line.expectedBaseQty} progress={line.progress} unit={line.material.baseUnit} /></div>
                        </div>)}
                      </div>
                    : lateLines.length > 0
                      ? <div className="mt-1 space-y-1 text-[11px] text-amber-900">
                          <p>同物料采购明细预计到货晚于需求最晚时间：</p>
                          {lateLines.map((line) => <div key={line.id}>{line.purchaseOrderNumber} · 可分配 {formatQuantity(line.allocatableQty)}{line.material.baseUnit} · 预计到货 {formatPurchaseDateTime(line.expectedAt)}</div>)}
                        </div>
                      : <p className="mt-1 text-[11px] text-stone-600">
                          没有可用开放采购明细。请先 <Link className="font-medium text-amber-900 underline" href="/v2/purchase-orders">创建采购单</Link>。
                        </p>}
            </div>}

            {summary.currentShortage > 1e-8 && canManageOrders && (compatibleMaterials.length > 0
              ? <details className="rounded border border-stone-300 bg-white p-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-emerald-900">人工替换物料（不自动替换）</summary>
                  <form action={substituteOrderMaterial} className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="requirementId" value={requirement.id} />
                    <label className="block text-[11px] text-stone-600 sm:col-span-2">替换为同单位物料
                      <select className={`${input} mt-0.5`} name="replacementMaterialId" required>
                        {replacementOptions.map((option) => <option key={option.material.id} value={option.material.id}>
                          {materialIdentityLabel(option.material)} · 可用 {formatQuantity(option.availableQty)}{option.material.baseUnit}
                        </option>)}
                      </select>
                    </label>
                    <label className="block text-[11px] text-stone-600">替换数量
                      <input className={`${input} mt-0.5`} name="replacementQty" type="number" min={step} step={step} required defaultValue={summary.plannedQty} />
                    </label>
                    <div className="flex items-end">
                      <button className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-medium text-emerald-900">确认人工替换</button>
                    </div>
                    <label className="block text-[11px] text-stone-600 sm:col-span-2">操作原因
                      <input className={`${input} mt-0.5`} name="reason" required placeholder="如：同色系替代，已与顾客说明" />
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-stone-600 sm:col-span-2">
                      <input type="checkbox" name="customerConfirmed" /> 顾客已确认等级 / 颜色 / 规格变化
                    </label>
                  </form>
                </details>
              : <p className="text-[11px] text-stone-500">暂无可替换的同基础单位物料。</p>)}
          </div>;
        }))}
      {order.items.every((item) => item.requirements.every((requirement) => requirement.revisionId !== latestRevision?.id)) &&
        <p className="text-sm text-stone-500">最新修订没有物料需求记录。</p>}
    </Section>

    <Section title="制作记录" hint={reservedLines.length > 0 ? `最新预留 ${reservedLines.length} 个任务 / 批次` : "无最新预留批次"}>
      {order.items.flatMap((item) => item.tasks.map((task) => <div key={task.id} className="rounded-lg border border-stone-200 bg-stone-50/60 p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium">{item.nameSnapshot} · 任务 {task.id.slice(0, 8)}</span>
          <span className={stateBadge}>{productionStateLabel(task.state)}</span>
        </div>
        <div className="mt-1 grid gap-1 text-xs text-stone-600 sm:grid-cols-2">
          <span>开始：{formatPurchaseDateTime(task.startedAt)}</span>
          <span>完成：{formatPurchaseDateTime(task.completedAt)}</span>
          <span>制作人员：{task.assigneeId || "未分配（不阻断）"}</span>
          <span>数量：{task.quantity}</span>
        </div>
        {task.usages.length > 0 && <div className="mt-2 space-y-0.5 text-[11px] text-stone-600">
          {task.usages.map((usage) => <div key={usage.id}>
            批次 {usage.batch.batchNo} · {usage.batch.material.name} · 实际 {formatQuantity(usage.usedQty)}{usage.batch.material.baseUnit} · 损耗 {formatQuantity(usage.lostQty)} · 退料 {formatQuantity(usage.returnedQty)}{usage.differenceReason ? ` · ${usage.differenceReason}` : ""}
          </div>)}
        </div>}
      </div>))}
      {order.items.every((item) => item.tasks.length === 0) && <p className="text-sm text-stone-500">暂无制作任务。</p>}
      {canManageProduction && canRecordActualUsage(order, reservedLines.length) && <details className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-amber-900">登记实际用料（有差异时展开）</summary>
        <form action={finishProductionWithUsage} className="mt-3 space-y-3">
          <input type="hidden" name="orderId" value={order.id} />
          {reservedLines.map((line) => <div key={`${line.taskId}:${line.batchId}`} className="rounded-lg border border-stone-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{line.itemName} · {line.materialCode} · {line.materialName}</span>
              <span className="text-xs text-stone-600">任务 {line.taskId.slice(0, 8)} · 批次 {line.batchNo} · 计划/预留 {line.quantity}{line.baseUnit}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="block text-xs text-stone-600">实际用量<input className={`${input} mt-1`} name={`usage.${line.taskId}.${line.batchId}.usedQty`} type="number" min="0" step={quantityStep(line.quantityScale)} defaultValue={line.quantity} required /></label>
              <label className="block text-xs text-stone-600">损耗<input className={`${input} mt-1`} name={`usage.${line.taskId}.${line.batchId}.lostQty`} type="number" min="0" step={quantityStep(line.quantityScale)} defaultValue={0} /></label>
              <label className="block text-xs text-stone-600">退料<input className={`${input} mt-1`} name={`usage.${line.taskId}.${line.batchId}.returnedQty`} type="number" min="0" step={quantityStep(line.quantityScale)} placeholder="留空自动计算" /></label>
            </div>
            <label className="mt-2 block text-xs text-stone-600">差异原因（与预留不一致时必填）
              <input className={`${input} mt-1`} name={`usage.${line.taskId}.${line.batchId}.reason`} placeholder="如：现场补用、修剪损耗" />
            </label>
          </div>)}
          <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white">按实际用料完成制作</button>
        </form>
      </details>}
    </Section>

    <Section title="配送信息与尝试历史" hint={order.fulfillment ? (order.fulfillment.kind === "PICKUP" ? "自提" : "配送") : "未安排交付方式"}>
      {order.fulfillment
        ? <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className={muted}>交付方式 / 预约</dt><dd>{order.fulfillment.kind === "PICKUP" ? "自提" : "配送"} · {formatPurchaseDateTime(order.fulfillment.scheduledAt)}</dd></div>
              <div><dt className={muted}>收件人</dt><dd>{order.fulfillment.recipientName || "—"} {order.fulfillment.recipientPhone || ""}</dd></div>
              <div className="sm:col-span-2"><dt className={muted}>地址</dt><dd className="break-all">{order.fulfillment.addressSnapshot || "—"}</dd></div>
              <div><dt className={muted}>交付时间</dt><dd>{formatPurchaseDateTime(order.fulfillment.handedOverAt)}</dd></div>
              <div><dt className={muted}>自提码</dt><dd>{order.fulfillment.pickupCode || "—"}</dd></div>
              <div><dt className={muted}>向顾客收取运费</dt><dd>¥{formatAmount(order.fulfillment.deliveryFeeCharged)}</dd></div>
              <div><dt className={muted}>预计 / 实际配送成本</dt><dd>¥{formatAmount(order.fulfillment.deliveryCostEstimated ?? 0)} / ¥{formatAmount(order.fulfillment.deliveryCostActual ?? 0)}</dd></div>
            </dl>
            <div className="space-y-2">
              {deliveryAttempts.length === 0
                ? <p className="text-sm text-stone-500">暂无配送尝试。</p>
                : deliveryAttempts.map((attempt) => {
                    const flags = deliveryAttemptActionFlags(attempt);
                    return <div key={attempt.id} className="rounded-lg border border-stone-200 bg-stone-50/60 p-3 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">第 {attempt.attemptNo} 次 · 预约 {formatPurchaseDateTime(order.fulfillment?.scheduledAt)}</span>
                        <span className={stateBadge}>{deliveryAttemptStateLabel(attempt.state)}</span>
                      </div>
                      <div className="mt-1 grid gap-1 text-xs text-stone-600 sm:grid-cols-2">
                        <span>出发：{formatPurchaseDateTime(attempt.departedAt)}</span>
                        <span>完成：{formatPurchaseDateTime(attempt.completedAt)}</span>
                        <span>失败原因：{attempt.failureReason || "—"}</span>
                        <span>配送成本：¥{formatAmount(attempt.deliveryCost ?? 0)}</span>
                      </div>
                      {canManageDelivery && (flags.start || flags.fail || flags.reschedule) && <div className="mt-2 flex flex-wrap gap-2">
                        {flags.start && <form action={startDeliveryAttempt}>
                          <input type="hidden" name="orderId" value={order.id} />
                          <input type="hidden" name="attemptId" value={attempt.id} />
                          <button className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-medium text-white">开始配送</button>
                        </form>}
                        {flags.fail && <details className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5">
                          <summary className="cursor-pointer text-xs font-medium text-rose-900">记录配送失败</summary>
                          <form action={failDeliveryAttempt} className="mt-2 flex flex-wrap items-end gap-2">
                            <input type="hidden" name="orderId" value={order.id} />
                            <input type="hidden" name="attemptId" value={attempt.id} />
                            <input className={input} name="reason" required placeholder="失败原因" />
                            <button className="rounded-lg border border-rose-700 px-3 py-2 text-xs font-medium text-rose-900">确认失败</button>
                          </form>
                        </details>}
                        {flags.reschedule && attempt.id === latestDeliveryAttemptId && <details className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5">
                          <summary className="cursor-pointer text-xs font-medium text-stone-800">重排配送</summary>
                          <form action={rescheduleDeliveryAttempt} className="mt-2 flex flex-wrap items-end gap-2">
                            <input type="hidden" name="orderId" value={order.id} />
                            <label className="text-[11px] text-stone-600">新时间<input className={`${input} mt-0.5`} name="scheduledAt" type="datetime-local" required /></label>
                            <label className="text-[11px] text-stone-600">备注<input className={`${input} mt-0.5`} name="note" /></label>
                            <button className="rounded-lg border border-stone-700 px-3 py-2 text-xs font-medium text-stone-800">确认重排</button>
                          </form>
                        </details>}
                      </div>}
                    </div>;
                  })}
            </div>

            {showCreateDeliveryAttempt && <details className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-emerald-900">新建配送尝试</summary>
              <form action={createDeliveryAttempt} className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="orderId" value={order.id} />
                <label className="text-xs text-stone-600">预约时间<input className={`${input} mt-1`} name="scheduledAt" type="datetime-local" /></label>
                <label className="text-xs text-stone-600">备注<input className={`${input} mt-1`} name="note" placeholder="如：顾客要求下午送达" /></label>
                <div className="sm:col-span-2"><button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white">创建配送尝试</button></div>
              </form>
            </details>}

            {showDeliveryCost && <details className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-amber-900">登记配送实际成本</summary>
              {note && <p className="mt-1 text-xs text-amber-900">最近备注：{note}</p>}
              <form action={recordDeliveryActualCost} className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="orderId" value={order.id} />
                <label className="text-xs text-stone-600">关联尝试
                  <select
                    className={`${input} mt-1`}
                    name="attemptId"
                    defaultValue={deliveryAttempts.find((attempt) => attempt.state !== "FAILED")?.id ?? deliveryAttempts[0]?.id}
                  >
                    {deliveryAttempts.map((attempt) => <option key={attempt.id} value={attempt.id}>第 {attempt.attemptNo} 次 · {deliveryAttemptStateLabel(attempt.state)}</option>)}
                  </select>
                </label>
                <label className="text-xs text-stone-600">实际成本（元）<input className={`${input} mt-1`} name="amount" type="number" min="0" step="0.01" defaultValue={Number(order.fulfillment?.deliveryCostActual ?? 0)} required /></label>
                <label className="text-xs text-stone-600 sm:col-span-2">备注<input className={`${input} mt-1`} name="note" placeholder="如：同城跑腿 / 自配送油费" defaultValue={note ?? ""} /></label>
                <div className="sm:col-span-2"><button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white">保存配送成本</button></div>
              </form>
            </details>}

            {showFinishDelivery && <form action={finishDelivery}>
              <input type="hidden" name="orderId" value={order.id} />
              <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white">交付完成并生成成本快照</button>
            </form>}
          </>
        : <p className="text-sm text-stone-500">该订单尚未创建交付安排。</p>}
    </Section>

    <Section title="成本明细" hint={latestSnapshot ? `最新快照第 ${latestSnapshot.revisionNo} 版` : "尚无结账快照"}>
      {latestSnapshot
        ? <div className="grid gap-2 sm:grid-cols-3">
            {snapshotRows.map(([label, value]) => <div key={label} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
              <p className={muted}>{label}</p>
              <p className="text-sm font-semibold">¥{formatAmount(value)}</p>
            </div>)}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className={muted}>总成本</p>
              <p className="text-sm font-semibold">¥{formatCents(Math.round((snapshotTotal ?? 0) * 100))}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className={muted}>毛利</p>
              <p className="text-sm font-semibold">¥{formatCents(Math.round((Number(latestSnapshot.revenue) - (snapshotTotal ?? 0)) * 100))}</p>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
              <p className={muted}>标记</p>
              <p className="text-sm font-semibold">{latestSnapshot.estimated ? "预估" : "已结算"}{order.costEntries.length === 0 ? " · 明细缺失" : ""}</p>
            </div>
          </div>
        : <p className="text-sm text-stone-500">交付完成后生成结账快照；当前没有历史快照。</p>}

      {costByKind.size === 0
        ? <p className="text-sm text-stone-500">暂无成本明细（缺失）。</p>
        : <div className="space-y-1">
            {[...costByKind.entries()].map(([kind, row]) => <div key={kind} className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs">
              <span className="font-medium">{costKindLabel(kind)} · {[...row.stages].map(costStageLabel).join(" / ")}</span>
              <span>¥{formatCents(Math.round(row.total * 100))}{row.estimated ? " · 预估" : ""}</span>
            </div>)}
          </div>}

      <div className="space-y-1">
        <p className="text-xs font-medium text-stone-700">成本条目</p>
        {order.costEntries.length === 0
          ? <p className="text-xs text-stone-500">缺失</p>
          : order.costEntries.map((entry) => <div key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-stone-600">
              <span>{costKindLabel(entry.kind)} · {costStageLabel(entry.stage)}{entry.estimated ? " · 预估" : ""}</span>
              <span>¥{formatAmount(entry.amount)} · {formatPurchaseDateTime(entry.calculatedAt)}</span>
            </div>)}
      </div>

      {order.costAdjustments.length > 0 && <div className="space-y-1">
        <p className="text-xs font-medium text-stone-700">成本调整（{order.costAdjustments.length} 条）</p>
        {order.costAdjustments.map((adjustment) => <div key={adjustment.id} className="text-[11px] text-stone-600">
          {costKindLabel(adjustment.kind)} {formatAdjustment(adjustment.amountDelta)} · {adjustment.reason} · {formatPurchaseDateTime(adjustment.createdAt)}
        </div>)}
      </div>}

      {note && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        配送实际成本备注：{note}
      </p>}
    </Section>

    {audits.length > 0 && <Section title="最近审核事件" hint={`${audits.length} 条`}>
      {audits.slice(0, 12).map((audit) => <div key={audit.id} className="text-[11px] text-stone-600">
        {audit.action} · {auditSummary(audit.afterSnapshot) ?? "—"} · {formatPurchaseDateTime(audit.occurredAt)}
      </div>)}
    </Section>}
  </>;
}
