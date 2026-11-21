import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  Prisma, PurchaseLineRelationKind, PurchaseState, ReservationState,
} from "@/generated/prisma-v2/client";
import { calculatePurchaseProgress } from "@/v2/domain/purchase-progress";
import { receivePurchase, rejectPurchase, finalizeBatchCost } from "../actions";
import {
  ActionEmptyState,
  Field,
  StatusBadge,
  V2ModulePage,
  V2Table,
  button,
  card,
  dataTableBody,
  dataTableHead,
  input,
  secondaryButton,
  stickyActionHead,
} from "../_components/V2Ui";
import { V2DrawerForm } from "../_components/V2Drawer";
import { materialPickerClass, materialPickerLabel } from "../_components/material-option-label";
import { readV2Feedback } from "../_lib/search-params";
import {
  PURCHASE_EPSILON, baseQuantityStep, describeProgressState, formatPurchaseDateTime, formatQuantity,
  isEligiblePurchaseLine, isLatePurchaseLine, materialIdentityLabel, outstandingAllocatableQty,
  purchaseLineAllocationLabel, purchaseOrderStateLabel, resolveExpectedBaseQty,
  shortageAllocationState, suggestedAllocationQuantity, summarizeShortageQuantities,
  toPurchaseReceiptRows,
} from "../_lib/purchase-ui";
import {
  allocatePurchaseLineAction, cancelPurchaseOrderAction, createLinkedPurchaseOrderAction,
  createPurchaseDraftAction, createPurchaseSupplementAction, submitPurchaseOrderAction, updatePurchaseDraftAction,
} from "./actions";
import { PurchaseOrderEditor } from "./PurchaseOrderEditor";

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<string, string> = { DRAFT: "草稿", ORDERED: "已下单", PARTIALLY_RECEIVED: "部分验收", RECEIVED: "已处理", CANCELLED: "已取消" };
/** Sticky action cell matching the shared 14rem action field width. */
const STICKY_ACTION = "sticky right-0 z-10 w-56 border-l border-stone-200 bg-white px-4 py-3 align-middle";
const STATE_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = { DRAFT: "neutral", ORDERED: "info", PARTIALLY_RECEIVED: "warning", RECEIVED: "success", CANCELLED: "danger" };
type Search = { q?: string | string[]; state?: string | string[]; message?: string | string[]; error?: string | string[]; requirementId?: string | string[]; supplierId?: string | string[] };
function dateTimeLocal(value: Date | null) { if (!value) return ""; const offset = value.getTimezoneOffset() * 60000; return new Date(value.getTime() - offset).toISOString().slice(0, 16); }

const openPurchaseInclude = {
  lines: {
    include: {
      material: true,
      allocations: { select: { purchaseLineId: true, requirementId: true, allocatedQty: true } },
      receiptLines: {
        select: {
          disposition: true,
          quantity: true,
          rejectionReason: true,
          receipt: { select: { receivedAt: true } },
        },
      },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;
type OpenPurchase = Prisma.PurchaseOrderGetPayload<{ include: typeof openPurchaseInclude }>;

const demandOrderInclude = {
  revisions: { orderBy: { number: "desc" }, take: 1 },
  items: {
    include: {
      requirements: {
        include: {
          material: true,
          reservations: { where: { state: ReservationState.ACTIVE }, select: { quantity: true } },
          purchaseAllocations: {
            include: {
              purchaseLine: {
                include: {
                  material: true,
                  allocations: { select: { allocatedQty: true } },
                  purchaseOrder: { select: { number: true, state: true, expectedAt: true } },
                  receiptLines: {
                    select: {
                      disposition: true,
                      quantity: true,
                      rejectionReason: true,
                      receipt: { select: { receivedAt: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;
type DemandOrder = Prisma.OrderGetPayload<{ include: typeof demandOrderInclude }>;
type DemandRequirement = DemandOrder["items"][number]["requirements"][number];

const targetRequirementInclude = {
  material: true,
  reservations: { where: { state: ReservationState.ACTIVE }, select: { quantity: true } },
  purchaseAllocations: { select: { allocatedQty: true } },
  orderItem: {
    include: {
      order: {
        include: {
          revisions: { orderBy: { number: "desc" }, take: 1 },
        },
      },
    },
  },
} satisfies Prisma.OrderMaterialRequirementInclude;

type OpenLine = {
  id: string;
  materialId: string;
  material: OpenPurchase["lines"][number]["material"];
  expectedBaseQty: number;
  allocatedQty: number;
  allocatableQty: number;
  progress: ReturnType<typeof calculatePurchaseProgress>;
  expectedAt: Date | null;
  purchaseOrderNumber: string;
  purchaseOrderState: string;
};

function buildOpenLines(openPurchases: OpenPurchase[]): OpenLine[] {
  const lines: OpenLine[] = [];
  for (const purchase of openPurchases) {
    for (const line of purchase.lines) {
      const expectedBaseQty = resolveExpectedBaseQty(line);
      if (expectedBaseQty === null || !Number.isFinite(expectedBaseQty) || expectedBaseQty <= 0) continue;
      let progress: ReturnType<typeof calculatePurchaseProgress>;
      try {
        progress = calculatePurchaseProgress(expectedBaseQty, toPurchaseReceiptRows(line.receiptLines));
      } catch {
        continue;
      }
      const allocatedQty = line.allocations.reduce((sum, row) => sum + Number(row.allocatedQty), 0);
      lines.push({
        id: line.id,
        materialId: line.materialId,
        material: line.material,
        expectedBaseQty,
        allocatedQty,
        allocatableQty: outstandingAllocatableQty(expectedBaseQty, progress.processedQty, allocatedQty),
        progress,
        expectedAt: purchase.expectedAt,
        purchaseOrderNumber: purchase.number,
        purchaseOrderState: purchase.state,
      });
    }
  }
  return lines;
}

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") redirect("/login?callbackUrl=/v2/purchase-orders");
  const { tenantId, storeId } = await requireV2Store("purchase");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const state = typeof params.state === "string" ? params.state : "open";
  const requirementId = typeof params.requirementId === "string" ? params.requirementId : "";
  const requestedSupplierId = typeof params.supplierId === "string" ? params.supplierId : "";
  // Filter options include inactive suppliers so historical purchase orders can
  // still be found; an unknown id is ignored rather than producing an empty page.
  const allSuppliers = await v2db.supplier.findMany({ where: { tenantId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  const supplierId = requestedSupplierId && allSuppliers.some((supplier) => supplier.id === requestedSupplierId) ? requestedSupplierId : "";
  const activeSuppliers = allSuppliers.filter((supplier) => supplier.active);
  const stateFilter: Prisma.PurchaseOrderWhereInput = state === "all" ? {} : state === "open" ? { state: { in: [PurchaseState.DRAFT, PurchaseState.ORDERED, PurchaseState.PARTIALLY_RECEIVED] } } : Object.values(PurchaseState).includes(state as PurchaseState) ? { state: state as PurchaseState } : {};
  const [materials, orders, openPurchases, batches, demandOrders, targetRequirement] = await Promise.all([
    v2db.material.findMany({ where: { tenantId, active: true }, orderBy: { code: "asc" } }),
    v2db.purchaseOrder.findMany({
      where: {
        tenantId, storeId, ...stateFilter,
        ...(supplierId ? { supplierId } : {}),
        ...(query ? { OR: [{ number: { contains: query, mode: "insensitive" } }, { supplier: { name: { contains: query, mode: "insensitive" } } }] } : {}),
      },
      include: {
        supplier: true,
        lines: {
          include: {
            material: true,
            receiptLines: {
              select: {
                id: true, disposition: true, quantity: true, rejectionReason: true, gradeChangeReason: true,
                acceptedMaterialId: true, finalUnitCost: true,
                acceptedMaterial: { select: { code: true, name: true } },
                receipt: { select: { receivedAt: true } },
              },
            },
            allocations: { include: { requirement: { include: { orderItem: { include: { order: { select: { number: true, buyerNameSnapshot: true } } } } } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    v2db.purchaseOrder.findMany({
      where: { tenantId, storeId, state: { in: [PurchaseState.ORDERED, PurchaseState.PARTIALLY_RECEIVED] } },
      include: openPurchaseInclude,
      orderBy: [{ createdAt: "desc" }, { number: "desc" }],
    }),
    v2db.inventoryBatch.findMany({ where: { storeId }, include: { material: true, balances: true }, orderBy: { receivedAt: "desc" }, take: 50 }),
    v2db.order.findMany({
      where: { tenantId, storeId, supplyState: "PURCHASE_REQUIRED" },
      include: demandOrderInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    requirementId ? v2db.orderMaterialRequirement.findFirst({
      where: { id: requirementId, orderItem: { order: { tenantId, storeId } } },
      include: targetRequirementInclude,
    }) : Promise.resolve(null),
  ]);
  const feedback = readV2Feedback(params);
  const supplierOptions = activeSuppliers.map((supplier) => ({ id: supplier.id, label: `${supplier.code} · ${supplier.name}` }));
  const materialOptions = materials.map((material) => ({
    id: material.id,
    code: material.code,
    name: material.name,
    baseUnit: material.baseUnit,
    active: material.active,
  }));
  const openLines = buildOpenLines(openPurchases);
  const targetQuantities = targetRequirement ? summarizeShortageQuantities({
    plannedQty: targetRequirement.plannedQty,
    reservedQtys: targetRequirement.reservations.map((row) => row.quantity),
    allocatedQtys: targetRequirement.purchaseAllocations.map((row) => row.allocatedQty),
  }) : null;
  const targetIsLatest = !!targetRequirement && targetRequirement.orderItem.order.revisions[0]?.id === targetRequirement.revisionId;
  const targetIsShortage = targetRequirement?.orderItem.order.supplyState === "PURCHASE_REQUIRED";
  const targetPending = targetQuantities?.pendingAssociationQty ?? 0;

  const shortageDemands: { order: DemandOrder; requirement: DemandRequirement; quantities: ReturnType<typeof summarizeShortageQuantities> }[] = [];
  for (const order of demandOrders) {
    const latestRevision = order.revisions[0];
    if (!latestRevision) continue;
    for (const item of order.items) {
      for (const requirement of item.requirements) {
        if (requirement.revisionId !== latestRevision.id) continue;
        const quantities = summarizeShortageQuantities({
          plannedQty: requirement.plannedQty,
          reservedQtys: requirement.reservations.map((row) => row.quantity),
          allocatedQtys: requirement.purchaseAllocations.map((row) => row.allocatedQty),
        });
        if (quantities.currentShortage <= PURCHASE_EPSILON && requirement.purchaseAllocations.length === 0) continue;
        shortageDemands.push({ order, requirement, quantities });
      }
    }
  }

  return <V2ModulePage title="采购单管理" description="创建多明细采购草稿、下单、验收、拒收和追踪关联订单缺料；到货验收也可在独立收货页完成。" message={feedback.message} error={feedback.error} actions={<div className="flex flex-wrap items-center gap-2">
    <Link href="/v2/receiving" className={secondaryButton}>采购收货</Link>
    <div id="new-purchase-order" className="scroll-mt-24"><V2DrawerForm
      triggerLabel="新建采购单"
      title="新建采购草稿"
      description="选择供应商、录入明细与费用；采购单号由系统自动生成。"
      action={createPurchaseDraftAction}
      submitLabel="创建采购草稿"
      size="xl"
      triggerClassName={button}
    >
      <PurchaseOrderEditor suppliers={supplierOptions} materials={materialOptions} />
    </V2DrawerForm></div>
  </div>}>
    {requirementId && <section className={`${card} border-amber-300`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">为订单缺料补货</h2><p className="mt-1 text-sm text-stone-600">为当前缺料需求创建一张正式的采购单，并在同一事务内关联到该需求；重复提交不会创建第二张采购单。</p></div>
        <a className="rounded-lg border border-amber-700 px-4 py-2 text-sm font-medium text-amber-900" href="/v2/orders">返回订单履约</a>
      </div>
      {!targetRequirement
        ? <p className="mt-4 rounded-lg border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-600">该缺料需求不存在或不属于当前门店，请返回订单页查看最新状态。</p>
        : !targetIsLatest
          ? <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">该需求不是订单最新版本，不能继续补货。请返回订单页查看最新版缺料需求。</p>
          : !targetIsShortage
            ? <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">该订单当前没有待采购的缺料需求，无需补货。请返回订单页查看最新供应状态。</p>
            : <div className="mt-4">
            <div className="grid gap-3 rounded-lg bg-zinc-50 p-4 text-sm md:grid-cols-4">
              <div>订单号<br /><strong>{targetRequirement.orderItem.order.number}</strong></div>
              <div>顾客<br /><strong>{targetRequirement.orderItem.order.buyerNameSnapshot || "未填写顾客"}</strong></div>
              <div>物料<br /><strong>{materialIdentityLabel(targetRequirement.material)}</strong></div>
              <div>需求最晚<br /><strong>{formatPurchaseDateTime(targetRequirement.needBy)}</strong></div>
              <div>计划数量<br /><strong>{formatQuantity(targetQuantities?.plannedQty)}{targetRequirement.material.baseUnit}</strong></div>
              <div>已预留<br /><strong>{formatQuantity(targetQuantities?.reservedQty)}{targetRequirement.material.baseUnit}</strong></div>
              <div>已分配采购<br /><strong>{formatQuantity(targetQuantities?.allocatedQty)}{targetRequirement.material.baseUnit}</strong></div>
              <div className={targetPending > PURCHASE_EPSILON ? "text-amber-900" : "text-emerald-800"}>待关联缺口<br /><strong>{formatQuantity(targetPending)}{targetRequirement.material.baseUnit}</strong></div>
            </div>
            {targetPending > PURCHASE_EPSILON
              ? <form action={createLinkedPurchaseOrderAction} className="mt-4 grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7rem_7rem_7rem_auto] xl:items-end">
                <input type="hidden" name="requirementId" value={targetRequirement.id} />
                <input type="hidden" name="idempotencyKey" value={`LINK-${targetRequirement.id}-${crypto.randomUUID()}`} />
                <input type="hidden" name="freightCost" value="0" />
                <input type="hidden" name="packagingCost" value="0" />
                <input type="hidden" name="otherCost" value="0" />
                <label className="block text-xs text-stone-600">供应商<select className={`${input} mt-1`} name="supplierId" required disabled={activeSuppliers.length === 0}>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select></label>
                <label className="block text-xs text-stone-600">预计到货<input className={`${input} mt-1`} name="expectedAt" type="datetime-local" max={dateTimeLocal(targetRequirement.needBy)} required /></label>
                <label className="block text-xs text-stone-600">采购数量<input className={`${input} mt-1`} name="quantity" type="number" min={baseQuantityStep(targetRequirement.material.quantityScale)} step={baseQuantityStep(targetRequirement.material.quantityScale)} defaultValue={targetPending} required /></label>
                <label className="block text-xs text-stone-600">分配数量<input className={`${input} mt-1`} name="allocationQuantity" type="number" min={baseQuantityStep(targetRequirement.material.quantityScale)} step={baseQuantityStep(targetRequirement.material.quantityScale)} defaultValue={targetPending} required /></label>
                <label className="block text-xs text-stone-600">采购单价<input className={`${input} mt-1`} name="unitPrice" type="number" min="0" step="0.0001" defaultValue={0} required /></label>
                <button className={button} disabled={activeSuppliers.length === 0}>创建采购单并关联</button>
              </form>
              : <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">该缺料需求的缺口已全部分配给采购明细，等待到货验收；如已发生拒收或采购行全部处理，请在下方缺料需求中重新采购或人工替换。</p>}
            {activeSuppliers.length === 0 && <p className="mt-2 text-xs text-amber-800">当前没有启用的供应商，无法创建采购单。</p>}
          </div>}
    </section>}

    <section className={`${card} border-amber-200`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">缺料需求与采购关联</h2><p className="mt-1 text-sm text-stone-600">将已下单或部分验收的采购明细关联到订单缺料需求；到货后系统会优先重检关联订单。</p></div>
        <a className="rounded-lg border border-amber-700 px-4 py-2 text-sm font-medium text-amber-900" href="/v2/orders">查看订单履约</a>
      </div>
      {shortageDemands.length === 0
        ? <p className="mt-4 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-500">当前没有待关联的缺料需求。</p>
        : <div className="mt-4 space-y-3">{shortageDemands.map(({ order, requirement, quantities }) => {
          const unit = requirement.material.baseUnit;
          const step = baseQuantityStep(requirement.material.quantityScale);
          const sameMaterialLines = openLines.filter((line) => line.materialId === requirement.materialId);
          const eligibleLines = sameMaterialLines.filter((line) => isEligiblePurchaseLine(line, requirement));
          const lateLines = sameMaterialLines.filter((line) => isLatePurchaseLine(line, requirement));
          const linkedLineIds = new Set(requirement.purchaseAllocations.map((allocation) => allocation.purchaseLineId));
          const unlinkedEligible = eligibleLines.filter((line) => !linkedLineIds.has(line.id));
          const allocationState = shortageAllocationState({
            sameMaterialLineCount: sameMaterialLines.length,
            availableLineCount: unlinkedEligible.length,
            lateLineCount: lateLines.length,
          });
          const firstAvailable = unlinkedEligible[0];
          const suggestedQty = suggestedAllocationQuantity(quantities.pendingAssociationQty, firstAvailable?.allocatableQty ?? 0);
          return <div key={requirement.id} id={`purchase-demand-${requirement.id}`} className="scroll-mt-6 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div><span className="font-semibold text-amber-950">{order.number}</span><span className="ml-2 text-stone-600">{order.buyerNameSnapshot || "未填写顾客"}</span></div>
              <div className={quantities.pendingAssociationQty > PURCHASE_EPSILON ? "font-medium text-amber-900" : "font-medium text-emerald-800"}>待关联缺口 {formatQuantity(quantities.pendingAssociationQty)}{unit}</div>
            </div>
            <div className="mt-1 grid gap-x-3 gap-y-0.5 text-xs text-stone-600 sm:grid-cols-2 lg:grid-cols-6">
              <span>物料 {materialIdentityLabel(requirement.material)}</span>
              <span>计划 {formatQuantity(quantities.plannedQty)}{unit}</span>
              <span>已预留 {formatQuantity(quantities.reservedQty)}{unit}</span>
              <span>已分配 {formatQuantity(quantities.allocatedQty)}{unit}</span>
              <span>待关联 {formatQuantity(quantities.pendingAssociationQty)}{unit}</span>
              <span>需求最晚 {formatPurchaseDateTime(requirement.needBy)}</span>
            </div>
            <div className="mt-2 rounded border border-amber-200 bg-white/70 px-2 py-1.5">
              <div className="font-medium text-amber-950">关联开放采购明细</div>
              {quantities.pendingAssociationQty <= PURCHASE_EPSILON
                ? <p className="mt-1 text-stone-600">此需求的缺口已全部分配给采购明细，等待到货验收；如已发生拒收或采购行全部处理，请查看下方关联行并重新采购或人工替换。</p>
                : allocationState === "AVAILABLE"
                  ? <form action={allocatePurchaseLineAction} className="mt-1 grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end">
                    <input type="hidden" name="requirementId" value={requirement.id} />
                    <label className="block text-[11px] text-stone-600">兼容采购明细<select className={`${input} mt-0.5`} name="purchaseLineId" required defaultValue={firstAvailable?.id}>{unlinkedEligible.map((line) => <option key={line.id} value={line.id}>{purchaseLineAllocationLabel({ purchaseOrderNumber: line.purchaseOrderNumber, materialCode: line.material.code, materialName: line.material.name, allocatableQty: line.allocatableQty, baseUnit: line.material.baseUnit, expectedAt: line.expectedAt })}</option>)}</select></label>
                    <label className="block text-[11px] text-stone-600">分配数量<input className={`${input} mt-0.5`} name="quantity" type="number" min={step} step={step} defaultValue={suggestedQty} required /></label>
                    <button className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-medium text-emerald-900">分配采购</button>
                  </form>
                  : allocationState === "LATE_LINE"
                    ? <div className="mt-1 space-y-1 text-stone-600">
                      <p>有同物料开放采购明细，但预计到货时间晚于需求最晚时间，不能关联：</p>
                      {lateLines.map((line) => <div key={line.id} className="rounded border border-amber-200 bg-amber-50 px-2 py-1">
                        {line.purchaseOrderNumber} · {line.material.code} {line.material.name} · 可分配 {formatQuantity(line.allocatableQty)}{line.material.baseUnit} · 预计到货 {formatPurchaseDateTime(line.expectedAt)}
                      </div>)}
                    </div>
                    : allocationState === "FULLY_ALLOCATED"
                      ? <div className="mt-1 space-y-1 text-stone-600">
                        <p>同物料开放采购明细已全部关联，或已没有未处理可分配数量；可在下方已关联行调整分配总量。</p>
                        {sameMaterialLines.map((line) => <div key={line.id} className="rounded border border-stone-300 bg-stone-50 px-2 py-1">
                          {line.purchaseOrderNumber} · {line.material.code} {line.material.name} · 可分配 {formatQuantity(line.allocatableQty)}{line.material.baseUnit} · {describeProgressState(line.progress)}
                        </div>)}
                      </div>
                      : <p className="mt-1 text-stone-600">没有同物料的兼容开放采购明细。请先点击页头“新建采购单”创建采购单，再到此关联。</p>}
            </div>
            {requirement.purchaseAllocations.length > 0 && <div className="mt-2 space-y-1">
              <div className="font-medium text-stone-700">已关联采购行与补货进度</div>
              {requirement.purchaseAllocations.map((allocation) => {
                const line = allocation.purchaseLine;
                const expectedBaseQty = resolveExpectedBaseQty(line);
                const progress = expectedBaseQty !== null && expectedBaseQty > 0
                  ? calculatePurchaseProgress(expectedBaseQty, toPurchaseReceiptRows(line.receiptLines))
                  : null;
                const lineAllocatedQty = line.allocations.reduce((sum, row) => sum + Number(row.allocatedQty), 0);
                const lineRemainingQty = progress
                  ? outstandingAllocatableQty(expectedBaseQty ?? 0, progress.processedQty, lineAllocatedQty)
                  : 0;
                const currentAllocatedQty = Number(allocation.allocatedQty);
                const canIncrease = !!progress && quantities.pendingAssociationQty > PURCHASE_EPSILON && lineRemainingQty > PURCHASE_EPSILON;
                const increaseDefault = Number((currentAllocatedQty + suggestedAllocationQuantity(quantities.pendingAssociationQty, lineRemainingQty)).toFixed(3));
                const rejections = line.receiptLines.filter((row) => row.disposition === "REJECTED");
                return <div key={allocation.id} className="rounded border border-stone-200 bg-white px-2 py-1 text-stone-700">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">需求物料 {materialIdentityLabel(line.material)} · 分配 {formatQuantity(currentAllocatedQty)}{unit}</span>
                    <span className="text-xs text-stone-500">待关联缺口 {formatQuantity(quantities.pendingAssociationQty)}{unit}</span>
                  </div>
                  <div className="text-xs text-stone-500">采购单 {line.purchaseOrder.number} · {purchaseOrderStateLabel(line.purchaseOrder.state)} · 预计到货 {formatPurchaseDateTime(line.purchaseOrder.expectedAt)}</div>
                  {progress && expectedBaseQty !== null
                    ? <>
                      <div className="text-xs text-stone-600">预计 {formatQuantity(expectedBaseQty)}{unit} · 原级合格 {formatQuantity(progress.acceptedOriginalQty)}{unit} · 降级 {formatQuantity(progress.downgradedQty)}{unit} · 拒收 {formatQuantity(progress.rejectedQty)}{unit} · 已处理 {formatQuantity(progress.processedQty)}{unit} · 剩余 {formatQuantity(progress.remainingQty)}{unit}</div>
                      {rejections.length > 0 && <div className="mt-0.5 text-xs text-amber-900">拒收记录：{rejections.map((row) => `${formatQuantity(row.quantity)}${unit} · ${row.rejectionReason || "未填写原因"} · ${formatPurchaseDateTime(row.receipt.receivedAt)}`).join("；")}</div>}
                      {quantities.pendingAssociationQty > PURCHASE_EPSILON && progress.remainingQty <= PURCHASE_EPSILON && <div className="mt-1 text-xs font-medium text-amber-900">该关联采购行已全部处理，但订单仍缺料，需要新建采购或人工替换。</div>}
                      {canIncrease && <form action={allocatePurchaseLineAction} className="mt-1 grid gap-1.5 sm:grid-cols-[9rem_auto] sm:items-end">
                        <input type="hidden" name="requirementId" value={requirement.id} />
                        <input type="hidden" name="purchaseLineId" value={line.id} />
                        <label className="block text-[11px] text-stone-600">该行分配总量<input className={`${input} mt-0.5`} name="quantity" type="number" min={currentAllocatedQty} max={currentAllocatedQty + lineRemainingQty} step={step} defaultValue={increaseDefault} required /></label>
                        <button className="rounded-lg border border-emerald-700 px-3 py-2 text-xs font-medium text-emerald-900">调整分配</button>
                      </form>}
                    </>
                    : <div className="text-xs text-amber-800">采购行缺少有效基础数量，无法计算补货进度。</div>}
                </div>;
              })}
            </div>}
          </div>;
        })}</div>}
    </section>

    <form className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4"><input className={`${input} max-w-sm`} name="q" defaultValue={query} placeholder="搜索采购单号或供应商" /><select className={`${input} w-40`} name="state" defaultValue={state}><option value="open">进行中</option><option value="DRAFT">草稿</option><option value="ORDERED">已下单</option><option value="PARTIALLY_RECEIVED">部分验收</option><option value="RECEIVED">已处理</option><option value="CANCELLED">已取消</option><option value="all">全部</option></select><select className={`${input} w-64`} name="supplierId" defaultValue={supplierId}><option value="">全部供应商</option>{allSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}{supplier.active ? "" : "（已停用）"}</option>)}</select>{requirementId && <input type="hidden" name="requirementId" value={requirementId} />}<button className={button}>查询</button></form>

    {orders.length === 0
      ? <ActionEmptyState title="还没有采购单" description="创建采购草稿，确认明细和费用后再正式下单。" />
      : <V2Table
        label="采购单列表"
        fields={["code", "name", "text", "numeric", "date", "status", "action"]}
        minWidthClass="min-w-[68rem]"
      >
        <caption className="sr-only">采购单列表</caption>
        <thead className={dataTableHead}><tr>
          <th scope="col" className="px-4 py-3 whitespace-nowrap">采购单</th>
          <th scope="col" className="px-4 py-3 whitespace-nowrap">供应商</th>
          <th scope="col" className="px-4 py-3 whitespace-nowrap">明细</th>
          <th scope="col" className="px-4 py-3 text-right whitespace-nowrap">预计金额</th>
          <th scope="col" className="px-4 py-3 whitespace-nowrap">预计到货</th>
          <th scope="col" className="px-4 py-3 whitespace-nowrap">状态</th>
          <th scope="col" className={`${stickyActionHead} whitespace-nowrap`}>操作</th>
        </tr></thead>
        <tbody className={dataTableBody}>{orders.map((order) => {
        const lineTotal = order.lines.reduce((sum, line) => sum + Number(line.orderedQty) * Number(line.unitPrice), 0);
        const total = lineTotal + Number(order.freightCost) + Number(order.packagingCost) + Number(order.otherCost);
        return <tr key={order.id} className="align-middle hover:bg-stone-50/70">
          <td className="px-4 py-3 align-middle">
            <div className="whitespace-nowrap font-medium">{order.number}</div>
            <div className="whitespace-nowrap text-xs text-stone-500">{order.createdAt.toLocaleString("zh-CN")}</div>
          </td>
          <td className="px-4 py-3 align-middle"><a className="text-emerald-700 hover:underline" href={`/v2/suppliers/${order.supplierId}`}>{order.supplier.name}</a></td>
          <td className="px-4 py-3 align-middle">{order.lines.length} 项<div className="text-xs text-stone-500">{order.lines.slice(0, 2).map((line) => line.material.name).join("、")}{order.lines.length > 2 ? "…" : ""}</div></td>
          <td className="whitespace-nowrap px-4 py-3 text-right align-middle tabular-nums">¥{total.toFixed(2)}<div className="text-xs text-stone-500">费用 ¥{(total - lineTotal).toFixed(2)}</div></td>
          <td className="px-4 py-3 align-middle">{order.expectedAt?.toLocaleString("zh-CN") ?? "未设置"}</td>
          <td className="px-4 py-3 align-middle"><StatusBadge tone={STATE_TONE[order.state]}>{STATE_LABEL[order.state]}</StatusBadge></td>
          <td className={STICKY_ACTION}><details><summary className="cursor-pointer text-emerald-700">查看详情</summary><div className="fixed inset-y-0 right-0 z-40 w-[min(48rem,95vw)] overflow-auto border-l border-zinc-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between"><h3 className="text-xl font-semibold">{order.number}</h3><span className="text-xs text-zinc-500">点击页面其他位置或再次点击“查看详情”关闭</span></div>
            <div className="mt-4 grid gap-3 rounded-lg bg-zinc-50 p-4 text-sm md:grid-cols-3">
              <div>供应商<br /><strong>{order.supplier.name}</strong></div>
              <div>预计到货<br /><strong>{order.expectedAt?.toLocaleString("zh-CN") ?? "未设置"}</strong></div>
              <div>预计总额<br /><strong>¥{total.toFixed(2)}</strong></div>
              <div>明细小计<br /><strong>¥{lineTotal.toFixed(2)}</strong></div>
              <div>运费<br /><strong>¥{Number(order.freightCost).toFixed(2)}</strong></div>
              <div>包装费<br /><strong>¥{Number(order.packagingCost).toFixed(2)}</strong></div>
              <div>其他费用<br /><strong>¥{Number(order.otherCost).toFixed(2)}</strong></div>
              <div className="md:col-span-2">采购备注<br /><strong>{order.notes || "未填写"}</strong></div>
            </div>
            <div className="mt-5 space-y-3">{order.lines.map((line) => {
              const expected = resolveExpectedBaseQty(line);
              const progress = expected !== null && expected > 0
                ? calculatePurchaseProgress(expected, toPurchaseReceiptRows(line.receiptLines))
                : null;
              const open = order.state === "ORDERED" || order.state === "PARTIALLY_RECEIVED";
              return <div key={line.id} className="rounded-lg border border-zinc-200 p-3">
                <div className="font-medium">{line.material.code} · {line.material.name}</div>
                {line.relationKind !== PurchaseLineRelationKind.ORIGINAL && <div className="mt-1 text-xs font-medium text-blue-800">
                  {line.relationKind === PurchaseLineRelationKind.EXTRA_ORDER ? "关联补单 / 额外到货" : "拒收后关联补送"} · 原明细 {line.sourceLineId?.slice(0, 8)}
                </div>}
                {progress && expected !== null
                  ? <div className="mt-1 text-xs text-zinc-600">采购 {formatQuantity(expected)}{line.material.baseUnit} · 原级合格 {formatQuantity(progress.acceptedOriginalQty)} · 降级 {formatQuantity(progress.downgradedQty)} · 拒收 {formatQuantity(progress.rejectedQty)} · 已处理 {formatQuantity(progress.processedQty)} · 剩余 {formatQuantity(progress.remainingQty)}</div>
                  : <div className="mt-1 text-xs text-amber-800">采购行缺少有效基础数量，无法计算进度。</div>}
                {line.channelLossRate !== null && (
                <div className="mt-1 text-xs text-amber-800">
                  渠道损耗 {formatQuantity(Number(line.channelLossRate) * 100)}%
                  {line.expectedUsableQty !== null
                    ? ` · 预计可用 ${formatQuantity(Number(line.expectedUsableQty))}${line.material.baseUnit}`
                    : ""}
                  {line.lossAdjustedUnitCost !== null
                    ? ` · 调整单价 ¥${Number(line.lossAdjustedUnitCost).toFixed(4)}`
                    : ""}
                </div>
              )}
              {line.allocations.length > 0 && <div className="mt-1 text-xs text-emerald-800">关联订单：{[...new Set(line.allocations.map((allocation) => allocation.requirement.orderItem.order.number))].join("、")}</div>}
                {open && progress && progress.remainingQty > PURCHASE_EPSILON && <div className="mt-3 grid gap-3 border-t border-zinc-100 pt-3 md:grid-cols-2">
                  <form action={receivePurchase} className="space-y-2">
                    <input type="hidden" name="purchaseLineId" value={line.id} />
                    <input type="hidden" name="idempotencyKey" value={`RECEIVE-${crypto.randomUUID()}`} />
                    <label className="text-xs">验收结果<select className={`${input} mt-1`} name="disposition"><option value="ACCEPTED">合格（原等级）</option><option value="DOWNGRADED">降级</option></select></label>
                    <label className="text-xs">降级后的物料<select className={`${input} ${materialPickerClass} mt-1`} name="acceptedMaterialId">{materialOptions.map((material) => <option key={material.id} value={material.id}>{materialPickerLabel(material)}</option>)}</select></label>
                    <Field label="数量" name="quantity" type="number" defaultValue={progress.remainingQty} />
                    <Field label="最终单位成本" name="finalUnitCost" type="number" defaultValue={Number(line.unitPrice)} />
                    <Field label="最晚可用时间" name="usableUntil" type="datetime-local" required={false} />
                    <Field label="降级原因" name="gradeChangeReason" required={false} />
                    <button className={button}>确认验收</button>
                  </form>
                  <form action={rejectPurchase} className="space-y-2">
                    <input type="hidden" name="purchaseLineId" value={line.id} />
                    <input type="hidden" name="idempotencyKey" value={`REJECT-${crypto.randomUUID()}`} />
                    <Field label="拒收数量" name="quantity" type="number" defaultValue={progress.remainingQty} />
                    <Field label="拒收原因" name="reason" />
                    <button className="rounded-lg border border-red-700 px-4 py-2 text-sm text-red-800">记录拒收</button>
                  </form>
                </div>}
                {line.relationKind === PurchaseLineRelationKind.ORIGINAL && order.state !== "DRAFT" && order.state !== "CANCELLED" && <div className="mt-3 flex flex-wrap gap-3 border-t border-zinc-100 pt-3">
                  <details className="rounded-lg border border-zinc-200 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium text-emerald-800">关联补单 / 额外到货</summary><form action={createPurchaseSupplementAction} className="mt-3 grid gap-2 sm:grid-cols-3">
                    <input type="hidden" name="sourceLineId" value={line.id} /><input type="hidden" name="kind" value={PurchaseLineRelationKind.EXTRA_ORDER} /><input type="hidden" name="relationKey" value={`EXTRA-${crypto.randomUUID()}`} />
                    <Field label="额外数量" name="quantity" type="number" /><Field label="采购单价" name="unitPrice" type="number" defaultValue={Number(line.unitPrice)} /><button className={button}>创建关联补单明细</button>
                  </form></details>
                  {progress && progress.rejectedQty > PURCHASE_EPSILON && <details className="rounded-lg border border-amber-300 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium text-amber-900">登记供应商补送</summary><form action={createPurchaseSupplementAction} className="mt-3 grid gap-2 sm:grid-cols-3">
                    <input type="hidden" name="sourceLineId" value={line.id} /><input type="hidden" name="kind" value={PurchaseLineRelationKind.REPLACEMENT_DELIVERY} /><input type="hidden" name="relationKey" value={`REDELIVERY-${crypto.randomUUID()}`} />
                    <Field label="补送数量" name="quantity" type="number" defaultValue={progress.rejectedQty} /><Field label="采购单价" name="unitPrice" type="number" defaultValue={Number(line.unitPrice)} /><button className={button}>创建关联补送明细</button>
                  </form></details>}
                </div>}
              </div>;
            })}</div>
            {order.state === "DRAFT" && <>
              <div className="mt-5">
                <V2DrawerForm
                  triggerLabel="编辑采购草稿"
                  title={`编辑采购草稿 · ${order.number}`}
                  description="修改供应商、明细与费用；采购单号保持不变。"
                  action={updatePurchaseDraftAction}
                  submitLabel="保存草稿"
                  size="xl"
                  triggerClassName="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
                >
                  <PurchaseOrderEditor suppliers={supplierOptions} materials={materialOptions} initial={{ purchaseOrderId: order.id, supplierId: order.supplierId, expectedAt: dateTimeLocal(order.expectedAt), freightCost: Number(order.freightCost), packagingCost: Number(order.packagingCost), otherCost: Number(order.otherCost), notes: order.notes ?? "", lines: order.lines.map((line) => ({ materialId: line.materialId, quantity: Number(line.orderedQty), unitPrice: Number(line.unitPrice) })) }} />
                </V2DrawerForm>
              </div>
              <form action={submitPurchaseOrderAction} className="mt-4"><input type="hidden" name="purchaseOrderId" value={order.id} /><button className={button}>确认下单</button></form>
            </>}
            {["DRAFT", "ORDERED"].includes(order.state) && <form action={cancelPurchaseOrderAction} className="mt-4 flex gap-2 border-t border-zinc-200 pt-4"><input type="hidden" name="purchaseOrderId" value={order.id} /><input className={input} name="reason" placeholder="填写取消原因" required /><button className="whitespace-nowrap rounded-lg border border-red-700 px-4 py-2 text-sm text-red-800">取消采购单</button></form>}
          </div></details></td>
        </tr>;
      })}</tbody></V2Table>}

    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">批次成本确认</h2><p className="mt-1 text-sm text-stone-600">验收后未确认的批次成本可在此最终确认；确认后未关单订单重算成本，已关单订单追加可见的成本调整记录。</p></div>
      </div>
      <div className="mt-4 max-h-72 overflow-auto text-xs text-stone-600">{batches.map((batch) => {
        const onHand = batch.balances.reduce((sum, balance) => sum + Number(balance.onHandQty), 0);
        return <div key={batch.id} className="border-b border-stone-100 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span>{batch.batchNo} · {batch.material.name} · 实存 {formatQuantity(onHand)} {batch.material.baseUnit}</span>
            <span className={batch.costEstimated ? "text-amber-800" : "text-emerald-800"}>{batch.costEstimated ? `预计单位成本 ¥${Number(batch.unitCost).toFixed(4)}` : `最终单位成本 ¥${Number(batch.unitCost).toFixed(4)}`}</span>
          </div>
          {batch.costEstimated && <details className="mt-1 rounded-lg border border-stone-200 bg-stone-50 p-2">
            <summary className="cursor-pointer font-medium text-emerald-900">最终确认批次成本</summary>
            <form action={finalizeBatchCost} className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
              <input type="hidden" name="batchId" value={batch.id} />
              <label className="block text-xs text-stone-600">最终单位成本<input className={`${input} mt-1`} name="finalUnitCost" type="number" min="0" step="0.0001" required defaultValue={Number(batch.unitCost)} /></label>
              <label className="block text-xs text-stone-600">调整原因<input className={`${input} mt-1`} name="reason" required placeholder="如：实际采购价差异" /></label>
              <button className={button}>确认成本</button>
            </form>
          </details>}
        </div>;
      })}{batches.length === 0 && <p className="py-2">暂无批次</p>}</div>
    </section>
  </V2ModulePage>;
}
