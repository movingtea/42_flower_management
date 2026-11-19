import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { requireV2AnyStore, requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { EPSILON, calculatePurchaseProgress } from "@/v2/domain/purchase-progress";
import { getMaterialAvailableQuantities, type MaterialAvailability } from "@/v2/services/material-availability";
import { getAppDayRangeUtc } from "@/lib/datetime";
import { Field, V2ModulePage, button, card } from "../_components/V2Ui";
import { MultiSkuOrderEditor } from "../MultiSkuOrderEditor";
import { readV2Feedback } from "../_lib/search-params";
import {
  formatPurchaseDateTime,
  formatQuantity,
  outstandingAllocatableQty,
  resolveExpectedBaseQty,
  summarizeShortageQuantities,
  toPurchaseReceiptRows,
} from "../_lib/purchase-ui";
import { createOrder } from "./actions";
import { OrderBoard } from "./OrderBoard";
import { OrderDetailDrawer, type OpenPurchaseLine } from "./OrderDetailDrawer";
import { OrderFilters } from "./OrderFilters";
import { OrderPagination } from "./OrderPagination";
import { orderDetailInclude, orderBoardInclude, type OrderAuditEvent, type OrderDetailData } from "./order-query";
import {
  ORDER_PAGE_SIZE,
  buildOrderQuery,
  clampPage,
  pageHref,
  parsePage,
  totalPages,
} from "./pagination";
import {
  COMMERCIAL_FILTER_OPTIONS,
  FULFILLMENT_FILTER_OPTIONS,
  PRODUCTION_FILTER_OPTIONS,
  SUPPLY_FILTER_OPTIONS,
  type OrderFilterValues,
} from "../_lib/order-ui";
import {
  CommercialState,
  FulfillmentState,
  ProductionState,
  SupplyState,
  type Prisma,
} from "@/generated/prisma-v2/client";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;
type OrdersSearchParams = {
  q?: SearchParamValue;
  deliveryDate?: SearchParamValue;
  commercial?: SearchParamValue;
  supply?: SearchParamValue;
  production?: SearchParamValue;
  fulfillment?: SearchParamValue;
  orderId?: SearchParamValue;
  page?: SearchParamValue;
  message?: SearchParamValue;
  error?: SearchParamValue;
};

function single(value: SearchParamValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeChoice(
  value: string | undefined,
  options: readonly { value: string }[],
): string | undefined {
  return value && options.some((option) => option.value === value) ? value : undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  try {
    getAppDayRangeUtc(value);
    return value;
  } catch {
    return undefined;
  }
}

function normalizeFilters(params: Record<string, SearchParamValue>): OrderFilterValues {
  const keyword = single(params.q)?.trim().slice(0, 100);
  return {
    q: keyword || undefined,
    deliveryDate: normalizeDate(single(params.deliveryDate)),
    commercial: normalizeChoice(single(params.commercial), COMMERCIAL_FILTER_OPTIONS),
    supply: normalizeChoice(single(params.supply), SUPPLY_FILTER_OPTIONS),
    production: normalizeChoice(single(params.production), PRODUCTION_FILTER_OPTIONS),
    fulfillment: normalizeChoice(single(params.fulfillment), FULFILLMENT_FILTER_OPTIONS),
  };
}

function buildOrderWhere(
  tenantId: string,
  storeId: string,
  filters: OrderFilterValues,
): Prisma.OrderWhereInput {
  const conditions: Prisma.OrderWhereInput[] = [];
  if (filters.q) {
    conditions.push({
      OR: [
        { number: { contains: filters.q, mode: "insensitive" } },
        { buyerNameSnapshot: { contains: filters.q, mode: "insensitive" } },
        { buyerPhoneSnapshot: { contains: filters.q, mode: "insensitive" } },
        { recipientNameSnapshot: { contains: filters.q, mode: "insensitive" } },
        { recipientPhoneSnapshot: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  if (filters.deliveryDate) {
    const range = getAppDayRangeUtc(filters.deliveryDate);
    conditions.push({ deliveryAt: { gte: range.startUtc, lt: range.endUtcExclusive } });
  }
  if (filters.commercial) conditions.push({ commercialState: filters.commercial as CommercialState });
  if (filters.supply) {
    conditions.push({ supplyState: filters.supply as SupplyState });
    // The dashboard "shortage" todo excludes cancelled/closed orders, so the
    // drill-down list must use the same actionable scope.
    if (filters.supply === "PURCHASE_REQUIRED") {
      conditions.push({ commercialState: { notIn: ["CANCELLED", "CLOSED"] } });
    }
  }
  if (filters.production) conditions.push({ productionState: filters.production as ProductionState });
  if (filters.fulfillment) conditions.push({ fulfillmentState: filters.fulfillment as FulfillmentState });
  return {
    tenantId,
    storeId,
    ...(conditions.length > 0 ? { AND: conditions } : {}),
  };
}

async function hasV2Capability(capability: "order" | "production" | "delivery" | "purchase"): Promise<boolean> {
  try {
    await requireV2Store(capability);
    return true;
  } catch {
    return false;
  }
}

export default async function OrdersPage({ searchParams }: PageProps<"/v2/orders">) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/orders");
  }
  const { tenantId, storeId } = await requireV2AnyStore(["order", "production", "delivery"]);
  const params = await searchParams as OrdersSearchParams;
  const filters = normalizeFilters(params);
  const requestedOrderId = single(params.orderId)?.trim() || undefined;
  const feedback = readV2Feedback(params);

  const orderWhere = buildOrderWhere(tenantId, storeId, filters);
  const totalOrderCount = await v2db.order.count({ where: orderWhere });
  const orderPageCount = totalPages(totalOrderCount);
  const page = clampPage(parsePage(single(params.page)), totalOrderCount);

  const [orders, selectedOrder, materials, purchases, skus, audits, canManageOrders, canManageProduction, canManageDelivery, canManagePurchases, shortageOrderCount] =
    await Promise.all([
      v2db.order.findMany({
        where: orderWhere,
        include: orderBoardInclude,
        orderBy: [{ deliveryAt: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * ORDER_PAGE_SIZE,
        take: ORDER_PAGE_SIZE,
      }),
      requestedOrderId
        ? v2db.order.findFirst({
            where: { id: requestedOrderId, tenantId, storeId },
            include: orderDetailInclude,
          })
        : Promise.resolve(null),
      v2db.material.findMany({ where: { tenantId }, orderBy: { code: "asc" } }),
      v2db.purchaseOrder.findMany({
        where: { tenantId, storeId, state: { in: ["ORDERED", "PARTIALLY_RECEIVED"] } },
        include: {
          lines: {
            include: {
              material: true,
              allocations: true,
              receiptLines: {
                select: {
                  id: true,
                  disposition: true,
                  quantity: true,
                  rejectionReason: true,
                  receipt: { select: { receivedAt: true } },
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { number: "desc" }],
      }),
      v2db.productSku.findMany({
        where: { product: { tenantId }, active: true },
        include: { product: true },
        orderBy: { code: "asc" },
        take: 100,
      }),
      requestedOrderId
        ? v2db.auditEvent.findMany({
            where: {
              tenantId,
              storeId,
              OR: [
                { entityType: "Order", entityId: requestedOrderId },
                {
                  entityType: "DeliveryAttempt",
                  afterSnapshot: { path: ["orderId"], equals: requestedOrderId },
                },
              ],
            },
            orderBy: { occurredAt: "desc" },
            take: 60,
          })
        : Promise.resolve([]),
      hasV2Capability("order"),
      hasV2Capability("production"),
      hasV2Capability("delivery"),
      hasV2Capability("purchase"),
      v2db.order.count({
        where: {
          tenantId,
          storeId,
          supplyState: "PURCHASE_REQUIRED",
          commercialState: { notIn: ["CANCELLED", "CLOSED"] },
        },
      }),
    ]);

  const openPurchaseLines: OpenPurchaseLine[] = purchases.flatMap((purchaseOrder) => {
    if (purchaseOrder.state !== "ORDERED" && purchaseOrder.state !== "PARTIALLY_RECEIVED") return [];
    return purchaseOrder.lines.flatMap((line) => {
      const expectedBaseQty = resolveExpectedBaseQty(line);
      if (expectedBaseQty === null || !Number.isFinite(expectedBaseQty) || expectedBaseQty <= 0) return [];
      const progress = calculatePurchaseProgress(expectedBaseQty, toPurchaseReceiptRows(line.receiptLines));
      const allocatedQty = line.allocations.reduce((sum, allocation) => sum + Number(allocation.allocatedQty), 0);
      const allocatableQty = outstandingAllocatableQty(expectedBaseQty, progress.processedQty, allocatedQty);
      return [{
        id: line.id,
        materialId: line.materialId,
        material: line.material,
        expectedBaseQty,
        allocatedQty,
        allocatableQty,
        progress,
        expectedAt: purchaseOrder.expectedAt,
        purchaseOrderNumber: purchaseOrder.number,
        label: `${purchaseOrder.number} · ${line.material.code} ${line.material.name} · 可分配 ${formatQuantity(allocatableQty)}${line.material.baseUnit} · 预计到货 ${purchaseOrder.expectedAt ? formatPurchaseDateTime(purchaseOrder.expectedAt) : "未设置"}`,
      }];
    });
  });

  // Availability is only needed for the selected order's latest shortage requirements.
  const availabilityByNeedBy = new Map<number, Map<string, MaterialAvailability>>();
  if (selectedOrder) {
    const latestRevisionId = selectedOrder.revisions[0]?.id;
    const requirements = selectedOrder.items.flatMap((item) => item.requirements)
      .filter((requirement) => requirement.revisionId === latestRevisionId);
    const replacementMaterialIdsByNeedBy = new Map<number, { needBy: Date; materialIds: Set<string> }>();
    for (const requirement of requirements) {
      const summary = summarizeShortageQuantities({
        plannedQty: requirement.plannedQty,
        reservedQtys: requirement.reservations
          .filter((reservation) => reservation.state === "ACTIVE")
          .map((reservation) => reservation.quantity),
        allocatedQtys: requirement.purchaseAllocations.map((allocation) => allocation.allocatedQty),
      });
      if (summary.currentShortage <= EPSILON) continue;
      const compatible = materials.filter((material) =>
        material.id !== requirement.materialId && material.baseUnit === requirement.material.baseUnit);
      if (compatible.length === 0) continue;
      const key = requirement.needBy.getTime();
      const group = replacementMaterialIdsByNeedBy.get(key) ?? {
        needBy: requirement.needBy,
        materialIds: new Set<string>(),
      };
      for (const material of compatible) group.materialIds.add(material.id);
      replacementMaterialIdsByNeedBy.set(key, group);
    }
    await Promise.all([...replacementMaterialIdsByNeedBy.entries()].map(async ([key, group]) => {
      const availability = await getMaterialAvailableQuantities(v2db, {
        tenantId,
        storeId,
        materialIds: [...group.materialIds],
        needBy: group.needBy,
      });
      availabilityByNeedBy.set(key, availability);
    }));
  }

  const currentFilterQuery = buildOrderQuery(filters, page);
  const closeHref = pageHref(page, filters);
  const selectedAudits: OrderAuditEvent[] = audits.map((audit) => ({
    id: audit.id,
    action: audit.action,
    afterSnapshot: audit.afterSnapshot,
    occurredAt: audit.occurredAt,
  }));

  return <V2ModulePage
    title="订单看板"
    description="按履约阶段查看订单；点击卡片打开右侧详情侧栏，筛选和详情都由 URL 驱动。"
    message={feedback.message}
    error={feedback.error}
    actions={<Link className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white" href="/v2/purchase-orders">查看采购单</Link>}
  >
    {canManageOrders && <details className={`${card} border-emerald-200`}>
      <summary className="cursor-pointer text-lg font-semibold text-stone-900">新建后台订单</summary>
      <form action={createOrder} className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <MultiSkuOrderEditor skus={skus.map((sku) => ({
            id: sku.id,
            label: `${sku.product.name} / ${sku.name} · ¥${Number(sku.price)}`,
          }))} />
        </div>
        <Field label="顾客称呼" name="buyerName" required={false} />
        <Field label="交付时间" name="deliveryAt" type="datetime-local" />
        <label className="block text-sm">交付方式
          <select className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" name="fulfillmentKind">
            <option value="PICKUP">自提</option>
            <option value="DELIVERY">配送</option>
          </select>
        </label>
        <Field label="收件人（配送填写）" name="recipientName" required={false} />
        <Field label="收件电话（配送填写）" name="recipientPhone" required={false} />
        <Field label="配送地址（配送填写）" name="address" required={false} />
        <Field label="向顾客收取运费" name="deliveryFee" type="number" defaultValue={0} />
        <Field label="预计配送成本" name="estimatedDeliveryCost" type="number" defaultValue={0} />
        <div className="flex items-end"><button className={button}>保存订单草稿</button></div>
      </form>
      <p className="mt-3 text-xs text-stone-500">确认后自动展开配方并预留批次；缺货订单保留待确认与采购风险。</p>
    </details>}

    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-amber-950">缺料采购关联</h2>
          <p className="mt-1 text-sm text-amber-900">
            当前有 {shortageOrderCount} 个缺料订单待处理，开放采购单 {purchases.length} 张。
            打开订单详情后，可将开放采购明细分配到最新版物料需求，或新建采购单并关联。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/v2/orders?supply=PURCHASE_REQUIRED"
            className="rounded-lg border border-amber-700 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            查看缺料订单
          </Link>
          <Link
            href="/v2/purchase-orders"
            className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800"
          >
            查看全部采购单
          </Link>
        </div>
      </div>
    </section>

    <OrderFilters values={filters} resultCount={totalOrderCount} />

    <OrderPagination page={page} pages={orderPageCount} total={totalOrderCount} filters={filters} />

    {totalOrderCount === 0 && <p className="rounded-xl border border-dashed border-stone-300 bg-white px-5 py-4 text-sm text-stone-500">
      当前筛选下没有订单。
    </p>}

    <OrderBoard
      orders={orders}
      filterQuery={currentFilterQuery}
      canManageOrders={canManageOrders}
      canManageProduction={canManageProduction}
      canManageDelivery={canManageDelivery}
    />

    {requestedOrderId && <OrderDetailDrawer
      order={selectedOrder as OrderDetailData | null}
      requestedOrderId={requestedOrderId}
      closeHref={closeHref}
      materials={materials}
      openPurchaseLines={openPurchaseLines}
      availabilityByNeedBy={availabilityByNeedBy}
      audits={selectedAudits}
      canManageOrders={canManageOrders}
      canManageProduction={canManageProduction}
      canManageDelivery={canManageDelivery}
      canManagePurchases={canManagePurchases}
    />}
  </V2ModulePage>;
}
