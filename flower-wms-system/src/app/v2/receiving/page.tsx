import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { PurchaseState, type Prisma } from "@/generated/prisma-v2/client";
import { calculatePurchaseProgress } from "@/v2/domain/purchase-progress";
import {
  ActionEmptyState,
  StatusBadge,
  V2FilterBar,
  V2FilterField,
  V2Meta,
  V2ModulePage,
  V2Progress,
  V2Section,
  V2StatCard,
  V2Table,
  button,
  dataTableBody,
  dataTableHead,
  input,
  numericCell,
  numericHead,
  secondaryButton,
  stickyActionCell,
  stickyActionHead,
} from "../_components/V2Ui";
import { readV2Feedback } from "../_lib/search-params";
import {
  formatPurchaseDateTime,
  formatQuantity,
  purchaseOrderStateLabel,
  resolveExpectedBaseQty,
  toPurchaseReceiptRows,
} from "../_lib/purchase-ui";
import {
  RECEIVING_STATE_OPTIONS,
  isReceivingLineActionable,
  isReceivingLineOverdue,
  normalizeReceivingState,
  receivingLineStatus,
  summarizeReceivingLines,
} from "./receiving-query";
import {
  ReceivingLineDrawer,
  type ReceivingLineData,
  type ReceivingReceiptRow,
} from "./ReceivingLineDrawer";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;
type ReceivingSearchParams = {
  q?: SearchParamValue;
  state?: SearchParamValue;
  supplierId?: SearchParamValue;
  message?: SearchParamValue;
  error?: SearchParamValue;
};

const STATE_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  ORDERED: "info",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "danger",
  CLOSED: "neutral",
};

const DISPOSITION_LABEL: Record<string, string> = {
  ACCEPTED: "合格入库",
  DOWNGRADED: "降级入库",
  REJECTED: "拒收",
};

const DISPOSITION_TONE: Record<string, "success" | "warning" | "danger"> = {
  ACCEPTED: "success",
  DOWNGRADED: "warning",
  REJECTED: "danger",
};

function single(value: SearchParamValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stateWhere(state: string): Prisma.PurchaseOrderWhereInput {
  if (state === "all") return {};
  if (state === "open") {
    return { state: { in: [PurchaseState.ORDERED, PurchaseState.PARTIALLY_RECEIVED] } };
  }
  return Object.values(PurchaseState).includes(state as PurchaseState)
    ? { state: state as PurchaseState }
    : { state: { in: [PurchaseState.ORDERED, PurchaseState.PARTIALLY_RECEIVED] } };
}

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<ReceivingSearchParams>;
}) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/receiving");
  }
  const { tenantId, storeId } = await requireV2Store("purchase");
  const params = await searchParams;
  const feedback = readV2Feedback(params);
  const query = single(params.q)?.trim().slice(0, 100) ?? "";
  const state = normalizeReceivingState(single(params.state));
  const requestedSupplierId = single(params.supplierId) ?? "";

  const suppliers = await v2db.supplier.findMany({
    where: { tenantId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, active: true },
  });
  const supplierId = requestedSupplierId && suppliers.some((supplier) => supplier.id === requestedSupplierId)
    ? requestedSupplierId
    : "";

  const where: Prisma.PurchaseOrderWhereInput = {
    tenantId,
    storeId,
    ...stateWhere(state),
    ...(supplierId ? { supplierId } : {}),
    ...(query ? {
      OR: [
        { number: { contains: query, mode: "insensitive" } },
        { supplier: { name: { contains: query, mode: "insensitive" } } },
        { lines: { some: { material: { OR: [
          { code: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
        ] } } } },
      ],
    } : {}),
  };

  const [orders, materials, recentReceipts] = await Promise.all([
    v2db.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { code: true, name: true } },
        lines: {
          include: {
            material: true,
            receiptLines: {
              select: {
                id: true,
                disposition: true,
                quantity: true,
                baseUnit: true,
                rejectionReason: true,
                gradeChangeReason: true,
                finalUnitCost: true,
                acceptedMaterial: { select: { code: true, name: true } },
                receipt: { select: { receivedAt: true } },
              },
              orderBy: { receipt: { receivedAt: "desc" } },
            },
            allocations: { select: { allocatedQty: true } },
          },
        },
      },
      orderBy: [{ expectedAt: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    v2db.material.findMany({
      where: { tenantId, active: true },
      select: { id: true, code: true, name: true, baseUnit: true, quantityScale: true },
      orderBy: { code: "asc" },
      take: 500,
    }),
    v2db.goodsReceipt.findMany({
      where: { storeId, purchaseOrderId: { not: null } },
      include: {
        purchaseOrder: { select: { number: true } },
        lines: {
          include: {
            purchaseLine: { include: { material: { select: { code: true, name: true, baseUnit: true } } } },
            acceptedMaterial: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { receivedAt: "desc" },
      take: 15,
    }),
  ]);

  const lines: ReceivingLineData[] = [];
  for (const order of orders) {
    for (const line of order.lines) {
      const expectedBaseQty = resolveExpectedBaseQty(line);
      if (expectedBaseQty === null || !Number.isFinite(expectedBaseQty) || expectedBaseQty <= 0) continue;
      let progress;
      try {
        progress = calculatePurchaseProgress(expectedBaseQty, toPurchaseReceiptRows(line.receiptLines));
      } catch {
        continue;
      }
      const receipts: ReceivingReceiptRow[] = line.receiptLines.map((receiptLine) => ({
        id: receiptLine.id,
        disposition: receiptLine.disposition,
        quantity: Number(receiptLine.quantity),
        baseUnit: receiptLine.baseUnit,
        rejectionReason: receiptLine.rejectionReason,
        gradeChangeReason: receiptLine.gradeChangeReason,
        finalUnitCost: receiptLine.finalUnitCost === null ? null : Number(receiptLine.finalUnitCost),
        acceptedMaterial: receiptLine.acceptedMaterial,
        receivedAt: receiptLine.receipt.receivedAt,
      }));
      lines.push({
        id: line.id,
        purchaseOrderId: order.id,
        purchaseOrderNumber: order.number,
        supplierName: order.supplier.name,
        orderState: order.state,
        expectedAt: order.expectedAt,
        material: {
          id: line.material.id,
          code: line.material.code,
          name: line.material.name,
          baseUnit: line.material.baseUnit,
          quantityScale: line.material.quantityScale,
        },
        orderedQty: Number(line.orderedQty),
        expectedBaseQty,
        processedQty: progress.processedQty,
        remainingQty: progress.remainingQty,
        rejectedQty: progress.rejectedQty,
        unitPrice: Number(line.unitPrice),
        channelLossRate: line.channelLossRate === null ? null : Number(line.channelLossRate),
        expectedUsableQty: line.expectedUsableQty === null ? null : Number(line.expectedUsableQty),
        lossAdjustedUnitCost: line.lossAdjustedUnitCost === null
          ? null
          : Number(line.lossAdjustedUnitCost),
        relationKind: line.relationKind,
        receipts,
      });
    }
  }

  const now = new Date();
  const summary = summarizeReceivingLines(lines, now);
  const materialOptions = materials.map((material) => ({
    id: material.id,
    code: material.code,
    name: material.name,
    baseUnit: material.baseUnit,
  }));
  const hasFilters = Boolean(query || supplierId || state !== "open");
  const receiptRows = recentReceipts.flatMap((receipt) => receipt.lines.map((line) => {
    const material = line.purchaseLine?.material ?? line.acceptedMaterial;
    return {
      id: line.id,
      receivedAt: receipt.receivedAt,
      purchaseOrderNumber: receipt.purchaseOrder?.number ?? "手工收货",
      materialCode: material?.code ?? "—",
      materialName: material?.name ?? "未知物料",
      baseUnit: line.baseUnit,
      disposition: line.disposition,
      quantity: Number(line.quantity),
      finalUnitCost: line.finalUnitCost === null ? null : Number(line.finalUnitCost),
      reason: line.rejectionReason ?? line.gradeChangeReason ?? "",
      acceptedMaterialName: line.acceptedMaterial ? `${line.acceptedMaterial.code} · ${line.acceptedMaterial.name}` : null,
    };
  }));

  return (
    <V2ModulePage
      title="采购收货"
      description="按采购明细完成合格验收、降级入库或拒收；到货数量和剩余缺口在同一页核对，验收后自动重检关联订单缺料。"
      message={feedback.message}
      error={feedback.error}
      actions={
        <>
          <Link href="/v2/purchase-orders" className={secondaryButton}>采购单管理</Link>
          <Link href="/v2/purchase-orders#new-purchase-order" className={button}>新建采购单</Link>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <V2StatCard
          label="待验收明细"
          value={summary.actionableLineCount}
          hint={`当前筛选共 ${summary.lineCount} 条采购明细`}
          tone={summary.actionableLineCount > 0 ? "warning" : "success"}
          icon="🧾"
        />
        <V2StatCard
          label="剩余待收数量"
          value={formatQuantity(summary.pendingQty)}
          hint="按基础单位合计；不同物料单位可能不同"
          tone={summary.pendingQty > 0 ? "warning" : "success"}
          icon="📦"
        />
        <V2StatCard
          label="涉及采购单"
          value={summary.orderCount}
          hint="同一采购单的多条明细只计一次"
          tone="info"
          icon="🚚"
        />
        <V2StatCard
          label="逾期未收明细"
          value={summary.overdueLineCount}
          hint="预计到货时间早于当前时间且仍有剩余数量"
          tone={summary.overdueLineCount > 0 ? "danger" : "success"}
          icon="⏰"
        />
      </div>

      <V2FilterBar
        key={`${query}|${state}|${supplierId}`}
        action="/v2/receiving"
        label="采购收货筛选"
        keyword={{
          defaultValue: query,
          placeholder: "采购单号、供应商、物料编号或名称",
          label: "关键词",
        }}
        resetHref={hasFilters ? "/v2/receiving" : undefined}
      >
        <V2FilterField label="采购状态" className="w-56">
          <select className={`${input} w-full`} name="state" defaultValue={state}>
            {RECEIVING_STATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </V2FilterField>
        <V2FilterField label="供应商" className="w-64">
          <select className={`${input} w-full`} name="supplierId" defaultValue={supplierId}>
            <option value="">全部供应商</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} · {supplier.name}{supplier.active ? "" : "（已停用）"}
              </option>
            ))}
          </select>
        </V2FilterField>
      </V2FilterBar>

      <div className="flex flex-wrap items-center gap-2">
        <V2Meta label="采购单">{summary.orderCount}</V2Meta>
        <V2Meta label="明细">{summary.lineCount}</V2Meta>
        <V2Meta label="可操作">{summary.actionableLineCount}</V2Meta>
        <V2Meta label="逾期">{summary.overdueLineCount}</V2Meta>
        <span className="text-xs text-stone-500">采购单状态为“已下单”或“部分验收”的明细才可验收或拒收。</span>
      </div>

      {lines.length === 0 ? (
        <ActionEmptyState
          title="当前筛选下没有采购明细"
          description={hasFilters
            ? "调整关键词、采购状态或供应商后再试；草稿采购单请先在采购单管理页面确认下单。"
            : "还没有已下单的采购明细。请先在采购单管理页面创建并确认采购单。"}
          actionHref="/v2/purchase-orders"
          actionLabel="前往采购单管理"
        />
      ) : (
        <V2Table
          label="采购收货明细"
          fields={["code", "name", "date", "numeric", "numeric", "numeric", "status", "action"]}
          minWidthClass="min-w-[70rem]"
        >
          <caption className="sr-only">采购收货明细</caption>
          <thead className={dataTableHead}>
            <tr>
              <th scope="col" className="px-4 py-3">采购单 / 供应商</th>
              <th scope="col" className="px-4 py-3">物料</th>
              <th scope="col" className="px-4 py-3">预计到货</th>
              <th scope="col" className={`${numericHead} px-4`}>采购数量</th>
              <th scope="col" className={`${numericHead} px-4`}>已处理</th>
              <th scope="col" className={`${numericHead} px-4`}>剩余</th>
              <th scope="col" className="px-4 py-3">进度</th>
              <th scope="col" className={stickyActionHead}>操作</th>
            </tr>
          </thead>
          <tbody className={dataTableBody}>
            {lines.map((line) => {
              const status = receivingLineStatus({ processedQty: line.processedQty, remainingQty: line.remainingQty });
              const overdue = isReceivingLineOverdue(line.expectedAt, line.remainingQty, now);
              const actionable = isReceivingLineActionable(line.remainingQty);
              return <tr key={line.id} className="align-top transition hover:bg-stone-50/70">
                <td className="px-4 py-3">
                  <Link
                    href={`/v2/purchase-orders?q=${encodeURIComponent(line.purchaseOrderNumber)}&state=all`}
                    className="font-medium text-stone-900 hover:text-emerald-800"
                  >
                    {line.purchaseOrderNumber}
                  </Link>
                  <div className="mt-0.5 text-xs text-stone-500">{line.supplierName}</div>
                  <div className="mt-1">
                    <StatusBadge tone={STATE_TONE[line.orderState] ?? "neutral"}>
                      {purchaseOrderStateLabel(line.orderState)}
                    </StatusBadge>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-stone-900">{line.material.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-stone-500">{line.material.code}</p>
                  {line.relationKind !== "ORIGINAL" ? (
                    <p className="mt-1 text-[11px] font-medium text-sky-800">
                      {line.relationKind === "EXTRA_ORDER" ? "关联补单 / 额外到货" : "拒收后关联补送"}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs">
                  <p>{formatPurchaseDateTime(line.expectedAt)}</p>
                  {overdue ? <div className="mt-1"><StatusBadge tone="danger">已逾期</StatusBadge></div> : null}
                </td>
                <td className={`${numericCell} px-4`}>{formatQuantity(line.expectedBaseQty)} {line.material.baseUnit}</td>
                <td className={`${numericCell} px-4`}>{formatQuantity(line.processedQty)} {line.material.baseUnit}</td>
                <td className={`${numericCell} px-4 ${actionable ? "font-semibold text-amber-900" : "text-emerald-800"}`}>
                  {formatQuantity(line.remainingQty)} {line.material.baseUnit}
                </td>
                <td className="w-36 px-4 py-3">
                  <V2Progress
                    value={line.processedQty}
                    max={line.expectedBaseQty}
                    tone={status.tone}
                    label={`${line.material.name} 验收进度`}
                  />
                  <div className="mt-1"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
                </td>
                <td className={stickyActionCell}>
                  <ReceivingLineDrawer line={line} materialOptions={materialOptions} />
                </td>
              </tr>;
            })}
          </tbody>
        </V2Table>
      )}

      <V2Section
        title="最近收货记录"
        description="最近 15 张采购收货单的明细，包含合格、降级和拒收；拒收不会增加可用库存。"
      >
        {receiptRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 px-5 py-8 text-center text-sm text-stone-500">
            还没有采购收货记录。
          </p>
        ) : (
          <V2Table
            label="最近采购收货记录"
            fields={["date", "code", "name", "status", "numeric", "numeric", "text"]}
            minWidthClass="min-w-[58rem]"
          >
            <thead className={dataTableHead}>
              <tr>
                <th scope="col" className="px-4 py-3">收货时间</th>
                <th scope="col" className="px-4 py-3">采购单</th>
                <th scope="col" className="px-4 py-3">物料</th>
                <th scope="col" className="px-4 py-3">处置</th>
                <th scope="col" className={`${numericHead} px-4`}>数量</th>
                <th scope="col" className={`${numericHead} px-4`}>最终成本</th>
                <th scope="col" className="px-4 py-3">原因 / 降级物料</th>
              </tr>
            </thead>
            <tbody className={dataTableBody}>
              {receiptRows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-4 py-3 text-xs">{formatPurchaseDateTime(row.receivedAt)}</td>
                  <td className="px-4 py-3 text-xs font-medium text-stone-900">{row.purchaseOrderNumber}</td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-medium text-stone-900">{row.materialName}</div>
                    <div className="font-mono text-stone-500">{row.materialCode}</div>
                    {row.acceptedMaterialName ? <div className="mt-0.5 text-stone-500">入库：{row.acceptedMaterialName}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={DISPOSITION_TONE[row.disposition] ?? "neutral"}>
                      {DISPOSITION_LABEL[row.disposition] ?? row.disposition}
                    </StatusBadge>
                  </td>
                  <td className={`${numericCell} px-4`}>{formatQuantity(row.quantity)} {row.baseUnit}</td>
                  <td className={`${numericCell} px-4`}>{row.finalUnitCost === null ? "—" : `¥${row.finalUnitCost.toFixed(4)}`}</td>
                  <td className="max-w-[18rem] px-4 py-3 text-xs text-stone-600">{row.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </V2Table>
        )}
      </V2Section>
    </V2ModulePage>
  );
}
