import Link from "next/link";
import { redirect } from "next/navigation";
import { TransactionKind } from "@/generated/prisma-v2/client";
import { auth } from "@/auth";
import { requireV2Context } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { Field, StatusBadge, V2ModulePage, button, card, input, tableHead, tableShell } from "../_components/V2Ui";
import { V2DrawerForm } from "../_components/V2Drawer";
import { readV2Feedback } from "../_lib/search-params";
import {
  LOSS_REASON_LABELS,
  LOSS_REASON_OPTIONS,
  lossReasonLabel,
  referenceTypeLabel,
  transactionKindLabel,
} from "./labels";
import {
  LOSS_PAGE_SIZE,
  LOSS_REVIEW_STATUS_OPTIONS,
  buildLossHref,
  buildLossWhere,
  clampLossPage,
  lossPageNumbers,
  lossReviewStatusLabel,
  lossTotalPages,
  normalizeLossFilters,
  parsePage,
  type LossSearchParams,
} from "./loss-query";
import { TransferLocationFields } from "./TransferLocationFields";
import {
  adjustInventoryAction,
  confirmStocktakeAction,
  createManualInboundAction,
  createStocktakeAction,
  recordLossAction,
  reviewUnknownBatchLossAction,
  reviewStocktakeAction,
  submitUnknownBatchLossAction,
  transferInventoryAction,
} from "./actions";

export const dynamic = "force-dynamic";

const STOCKTAKE_LINE_LIMIT = 3;

type BatchOptionData = {
  id: string;
  batchNo: string;
  unitCost: unknown;
  material: { code: string; name: string; baseUnit: string };
  balances: {
    locationId: string;
    onHandQty: unknown;
    frozenQty: unknown;
    location: { code: string };
  }[];
};

type LocationOptionData = { id: string; code: string; kind: string };

function formatQty(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "—";
}

function formatCost(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `¥${parsed.toFixed(4)}` : "¥—";
}

function availableQty(onHand: unknown, frozen: unknown): number {
  return Math.max(0, Number(onHand) - Number(frozen));
}

function locationKindLabel(kind: string): string {
  return kind === "WAREHOUSE" ? "仓库" : kind === "PRODUCTION" ? "加工区" : kind;
}

function locationLabel(location: LocationOptionData, onHand: number): string {
  return `${location.code} · ${locationKindLabel(location.kind)} · 库位实存合计 ${formatQty(onHand)}`;
}

function batchLabel(batch: BatchOptionData): string {
  const balances = batch.balances.length
    ? batch.balances
        .map((balance) => `${balance.location.code} 实存${formatQty(balance.onHandQty)}/可用${formatQty(availableQty(balance.onHandQty, balance.frozenQty))}`)
        .join("；")
    : "暂无库位余额";
  return `${batch.batchNo} · ${batch.material.code} ${batch.material.name} · ${batch.material.baseUnit} · 成本${formatCost(batch.unitCost)} · ${balances}`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function diffValue(counted: unknown, recorded: unknown): number {
  return Number(counted) - Number(recorded);
}

function signedQty(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value > 0 ? `+${value}` : String(value);
}

function transactionTone(kind: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (kind === "LOSS") return "danger";
  if (kind === "ADJUSTMENT") return "warning";
  if (kind === "TRANSFER") return "info";
  if (kind === "INBOUND") return "success";
  return "neutral";
}

function lossReviewStatusTone(status: string | null): "success" | "warning" | "danger" | "neutral" {
  if (status === "APPROVED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "REJECTED") return "danger";
  return "neutral";
}

function BatchOptions({ batches }: { batches: BatchOptionData[] }) {
  return (
    <>
      {batches.map((batch) => (
        <option key={batch.id} value={batch.id}>{batchLabel(batch)}</option>
      ))}
    </>
  );
}

function LocationOptions({ locations, totals }: { locations: LocationOptionData[]; totals: Map<string, number> }) {
  return (
    <>
      {locations.map((location) => (
        <option key={location.id} value={location.id}>{locationLabel(location, totals.get(location.id) ?? 0)}</option>
      ))}
    </>
  );
}

function MissingSetup({ children }: { children: string }) {
  return (
    <p className="mt-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      {children}
    </p>
  );
}

export default async function OperationsPage({ searchParams }: { searchParams: Promise<LossSearchParams> }) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") redirect("/login?callbackUrl=/v2/operations");
  const access = await requireV2Context("purchase");
  const { tenantId, storeId } = access;
  const canReviewInventory = access.capabilities.includes("inventory_review");
  const params = await searchParams;
  const feedback = readV2Feedback(params);
  const lossFilters = normalizeLossFilters(params);
  const lossWhere = buildLossWhere(storeId, lossFilters);
  const lossTotal = await v2db.lossRecord.count({ where: lossWhere });
  const lossPageCount = lossTotalPages(lossTotal);
  const lossPage = clampLossPage(parsePage(params.page), lossTotal);

  const [materials, locations, batches, recentInbound, recentTransactions, recentLosses, pendingLosses, draftStocktakes, pendingStocktakes, confirmedStocktakes] = await Promise.all([
    v2db.material.findMany({ where: { tenantId, active: true }, orderBy: { code: "asc" }, take: 500 }),
    v2db.inventoryLocation.findMany({ where: { storeId }, orderBy: { code: "asc" }, take: 100 }),
    v2db.inventoryBatch.findMany({
      where: { storeId, material: { tenantId } },
      include: { material: true, balances: { include: { location: true } } },
      orderBy: [{ material: { code: "asc" } }, { receivedAt: "asc" }],
      take: 200,
    }),
    v2db.inventoryTransaction.findMany({
      where: { batch: { storeId }, kind: "INBOUND" },
      include: { batch: { include: { material: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    v2db.inventoryTransaction.findMany({
      where: {
        batch: { storeId },
        kind: { in: [TransactionKind.ADJUSTMENT, TransactionKind.TRANSFER, TransactionKind.LOSS] },
      },
      include: { batch: { include: { material: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    v2db.lossRecord.findMany({
      where: lossWhere,
      include: { batch: { include: { material: true } }, material: true, location: true },
      orderBy: { occurredAt: "desc" },
      skip: (lossPage - 1) * LOSS_PAGE_SIZE,
      take: LOSS_PAGE_SIZE,
    }),
    v2db.lossRecord.findMany({
      where: { storeId, reviewStatus: "PENDING", pendingBatchVerification: true },
      include: { material: true, location: true }, orderBy: { occurredAt: "desc" }, take: 20,
    }),
    v2db.stocktake.findMany({
      where: { storeId, state: "DRAFT" },
      include: { lines: { include: { batch: { include: { material: true } }, location: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    v2db.stocktake.findMany({
      where: { storeId, state: "PENDING_REVIEW" },
      include: { lines: { include: { batch: { include: { material: true } }, location: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    v2db.stocktake.findMany({
      where: { storeId, state: "CONFIRMED" },
      include: { lines: { include: { batch: { include: { material: true } }, location: true } } },
      orderBy: { confirmedAt: "desc" },
      take: 10,
    }),
  ]);

  const locationCodes = new Map(locations.map((location) => [location.id, location.code]));
  const locationTotals = new Map<string, number>();
  for (const batch of batches) {
    for (const balance of batch.balances) {
      locationTotals.set(balance.locationId, (locationTotals.get(balance.locationId) ?? 0) + Number(balance.onHandQty));
    }
  }
  const transferLocations = locations.map((location) => ({
    id: location.id,
    code: location.code,
    kindLabel: locationKindLabel(location.kind),
    onHand: locationTotals.get(location.id) ?? 0,
  }));
  const setupReady = batches.length > 0 && locations.length > 0;

  return (
    <V2ModulePage
      title="仓储日常"
      description="在同一页完成库存调整、库位移库、盘点与损耗登记；保留紧急现采的手工入库。所有库存变动都会形成可追溯流水。"
      message={feedback.message}
      error={feedback.error}
      actions={<Link href="/v2/inventory" className="text-sm text-emerald-700 hover:underline">查看库存管理</Link>}
    >
      <nav aria-label="库存作业入口" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <a href="#adjust" className={`${card} block transition hover:border-emerald-400 hover:shadow-md`}>
          <span className="font-semibold text-emerald-800">库存调整</span>
          <span className="mt-1 block text-xs text-zinc-500">盘盈 / 盘亏补录，生成 ADJUSTMENT 流水</span>
        </a>
        <a href="#transfer" className={`${card} block transition hover:border-emerald-400 hover:shadow-md`}>
          <span className="font-semibold text-emerald-800">库位移库</span>
          <span className="mt-1 block text-xs text-zinc-500">同批次在库位之间转移实存</span>
        </a>
        <a href="#stocktake" className={`${card} block transition hover:border-emerald-400 hover:shadow-md`}>
          <span className="font-semibold text-emerald-800">盘点</span>
          <span className="mt-1 block text-xs text-zinc-500">先建草稿，确认后才调整库存</span>
        </a>
        <a href="#loss" className={`${card} block transition hover:border-emerald-400 hover:shadow-md`}>
          <span className="font-semibold text-emerald-800">损耗登记</span>
          <span className="mt-1 block text-xs text-zinc-500">记录护理损伤、过期等损耗</span>
        </a>
      </nav>

      <section id="adjust" className={`${card} scroll-mt-24`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">库存调整</h3>
            <p className="mt-1 text-sm text-zinc-500">按指定批次和库位增加或减少实存，用于盘盈、盘亏补录。提交后生成 ADJUSTMENT 流水。</p>
          </div>
          <StatusBadge tone="info">库存作业 1/4</StatusBadge>
        </div>
        {!setupReady ? <MissingSetup>当前门店还没有可调整的批次或库位。请先通过手工入库或采购验收建立批次，并确认门店库位已配置。</MissingSetup> : (
          <form action={adjustInventoryAction} className="mt-4 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="idempotencyKey" value={`ADJ-${crypto.randomUUID()}`} />
            <label className="block text-sm text-stone-700 md:col-span-2">
              批次 / 物料 / 库位余额
              <select className={`${input} mt-1`} name="batchId" required defaultValue="">
                <option value="" disabled>请选择批次</option>
                <BatchOptions batches={batches} />
              </select>
            </label>
            <label className="block text-sm text-stone-700">
              调整库位
              <select className={`${input} mt-1`} name="locationId" required defaultValue="">
                <option value="" disabled>请选择库位</option>
                <LocationOptions locations={locations} totals={locationTotals} />
              </select>
            </label>
            <label className="block text-sm text-stone-700">
              调整方向
              <select className={`${input} mt-1`} name="mode" defaultValue="INCREASE">
                <option value="INCREASE">增加（盘盈 / 补录）</option>
                <option value="DECREASE">减少（盘亏）</option>
              </select>
            </label>
            <label className="block text-sm text-stone-700">
              调整数量（物料基础单位）
              <input className={`${input} mt-1`} name="quantity" type="number" min="0.001" step="0.001" required placeholder="例如 3" />
              <span className="mt-1 block text-xs text-zinc-500">必须大于零，最多 3 位小数；系统按物料精度与库位实存校验。</span>
            </label>
            <label className="block text-sm text-stone-700 md:col-span-2">
              调整原因
              <textarea className={`${input} mt-1 min-h-20`} name="reason" required placeholder="例如：盘点发现少 2 支，已复核" />
            </label>
            <div className="flex flex-wrap items-center gap-3 md:col-span-2">
              <button className={button} disabled={!setupReady}>提交库存调整</button>
              <p className="text-xs text-zinc-500">减少不得超过该库位当前实存；库存流水会记录操作前后的可核对数量。</p>
            </div>
          </form>
        )}
      </section>

      <section id="transfer" className={`${card} scroll-mt-24`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">库位移库</h3>
            <p className="mt-1 text-sm text-zinc-500">同一批次在店内库位之间转移实存，用于从仓库移入加工区或调整存放位置。</p>
          </div>
          <StatusBadge tone="info">库存作业 2/4</StatusBadge>
        </div>
        {!setupReady ? <MissingSetup>当前门店还没有可移库的批次或库位。请先完成入库并配置至少两个库位。</MissingSetup> : (
          <form action={transferInventoryAction} className="mt-4 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="idempotencyKey" value={`TRF-${crypto.randomUUID()}`} />
            <label className="block text-sm text-stone-700 md:col-span-2">
              批次 / 物料 / 库位余额
              <select className={`${input} mt-1`} name="batchId" required defaultValue="">
                <option value="" disabled>请选择批次</option>
                <BatchOptions batches={batches} />
              </select>
            </label>
            <TransferLocationFields locations={transferLocations} />
            <label className="block text-sm text-stone-700">
              移库数量（物料基础单位）
              <input className={`${input} mt-1`} name="quantity" type="number" min="0.001" step="0.001" required placeholder="例如 2" />
              <span className="mt-1 block text-xs text-zinc-500">不得超过源库位实存；系统会按物料精度校验。</span>
            </label>
            <label className="block text-sm text-stone-700">
              移库原因（可选）
              <input className={`${input} mt-1`} name="reason" placeholder="例如：移入加工区备货" />
            </label>
            <div className="flex flex-wrap items-center gap-3 md:col-span-2">
              <button className={button} disabled={!setupReady}>提交库位移库</button>
              <p className="text-xs text-zinc-500">源库位和目标库位必须不同；提交后生成 TRANSFER 流水。</p>
            </div>
          </form>
        )}
      </section>

      <section id="stocktake" className={`${card} scroll-mt-24`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">盘点</h3>
            <p className="mt-1 text-sm text-zinc-500">先创建盘点草稿，核对实盘数量后再确认。只有“确认盘点”会调整库存并生成 ADJUSTMENT 流水。</p>
          </div>
          <StatusBadge tone="info">库存作业 3/4</StatusBadge>
        </div>
        {!setupReady ? <MissingSetup>当前门店还没有可盘点的批次或库位。请先完成入库并配置库位。</MissingSetup> : (
          <form action={createStocktakeAction} className="mt-4 space-y-3">
            <input type="hidden" name="idempotencyKey" value={`STK-${crypto.randomUUID()}`} />
            {Array.from({ length: STOCKTAKE_LINE_LIMIT }, (_, index) => (
              <fieldset key={index} className="rounded-xl border border-stone-200 p-3">
                <legend className="px-1 text-xs font-medium text-stone-500">
                  盘点行 {index + 1}{index === 0 ? "（至少填写一行）" : "（可选）"}
                </legend>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="block text-sm text-stone-700 md:col-span-3">
                    批次 / 物料 / 库位余额
                    <select className={`${input} mt-1`} name={`batchId-${index}`} defaultValue="">
                      <option value="">不盘点此批次</option>
                      <BatchOptions batches={batches} />
                    </select>
                  </label>
                  <label className="block text-sm text-stone-700">
                    盘点库位
                    <select className={`${input} mt-1`} name={`locationId-${index}`} defaultValue="">
                      <option value="">请选择库位</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>{locationLabel(location, locationTotals.get(location.id) ?? 0)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm text-stone-700">
                    实盘数量
                    <input className={`${input} mt-1`} name={`countedQty-${index}`} type="number" min="0" step="0.001" placeholder="例如 12" />
                  </label>
                  <label className="block text-sm text-stone-700">
                    差异原因（可选）
                    <input className={`${input} mt-1`} name={`reason-${index}`} placeholder="例如：护理损耗未登记" />
                  </label>
                </div>
              </fieldset>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <button className={button} disabled={!setupReady}>创建盘点草稿</button>
              <p className="text-xs text-zinc-500">未选择批次的空行会被忽略；草稿不会改变库存。</p>
            </div>
          </form>
        )}

        <div className="mt-6 space-y-3">
          <h4 className="text-sm font-semibold text-zinc-800">待确认盘点草稿</h4>
          {draftStocktakes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center text-sm text-zinc-500">暂无待确认的盘点草稿。</p>
          ) : draftStocktakes.map((draft) => (
            <div key={draft.id} className="rounded-xl border border-stone-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">盘点单 <span className="font-mono text-xs text-zinc-600" title={draft.id}>{shortId(draft.id)}</span> <StatusBadge tone="warning">草稿</StatusBadge></p>
                  <p className="mt-1 text-xs text-zinc-500">创建于 {draft.createdAt.toLocaleString("zh-CN")} · {draft.lines.length} 行明细</p>
                </div>
                <form action={confirmStocktakeAction} className="shrink-0">
                  <input type="hidden" name="stocktakeId" value={draft.id} />
                  <button className={button}>确认盘点</button>
                </form>
              </div>
              <div className={`${tableShell} mt-3`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className={tableHead}>
                      <tr><th className="px-4 py-3">批次 / 物料</th><th>库位</th><th>账面数量</th><th>实盘数量</th><th>差异</th><th className="px-4">差异原因</th></tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {draft.lines.map((line) => {
                        const diff = diffValue(line.countedQty, line.recordedQty);
                        return (
                          <tr key={line.id}>
                            <td className="px-4 py-3"><div className="font-medium">{line.batch.batchNo}</div><div className="text-xs text-zinc-500">{line.batch.material.code} · {line.batch.material.name}</div></td>
                            <td>{line.location.code}</td>
                            <td>{formatQty(line.recordedQty)} {line.batch.material.baseUnit}</td>
                            <td>{formatQty(line.countedQty)} {line.batch.material.baseUnit}</td>
                            <td className={diff === 0 ? "text-zinc-500" : diff > 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>{signedQty(diff)}</td>
                            <td className="px-4">{line.reason || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="mt-2 text-xs text-amber-700">确认后会按实盘数量更新对应批次库位实存，并生成 ADJUSTMENT 流水；重复确认由服务层保护。</p>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-3">
          <h4 className="text-sm font-semibold text-zinc-800">待库存复核</h4>
          {pendingStocktakes.length === 0 ? <p className="text-sm text-zinc-500">暂无待复核盘点。</p> : pendingStocktakes.map((stocktake) => <div key={stocktake.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="font-medium text-amber-950">盘点单 <span className="font-mono text-xs">{shortId(stocktake.id)}</span> <StatusBadge tone="warning">待复核</StatusBadge></p>
            <p className="mt-1 text-xs text-amber-900">触发原因：{stocktake.reviewReasons.join("、") || "库存风险规则"}；复核通过前库存不会调整。</p>
            <div className="mt-2 text-xs text-stone-700">{stocktake.lines.map((line) => <div key={line.id}>{line.batch.batchNo} · {line.batch.material.name} @ {line.location.code}：{formatQty(line.recordedQty)} → {formatQty(line.countedQty)}（{signedQty(diffValue(line.countedQty, line.recordedQty))}）</div>)}</div>
            {canReviewInventory ? <form action={reviewStocktakeAction} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="stocktakeId" value={stocktake.id} />
              <input className={`${input} min-w-64 flex-1`} name="note" required placeholder="填写复核意见" />
              <button className={button} name="decision" value="APPROVE">复核通过并调整库存</button>
              <button className="rounded-lg border border-red-700 px-4 py-2 text-sm text-red-800" name="decision" value="REJECT">拒绝调整</button>
            </form> : <p className="mt-2 text-xs text-amber-800">仅本店经理或库存复核授权人员可处理。</p>}
          </div>)}
        </div>

        <div className="mt-6">
          <h4 className="mb-3 text-sm font-semibold text-zinc-800">最近已确认盘点</h4>
          <div className={tableShell}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className={tableHead}>
                  <tr><th className="px-4 py-3">盘点单</th><th>确认时间</th><th className="px-4">明细差异</th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {confirmedStocktakes.map((stocktake) => (
                    <tr key={stocktake.id}>
                      <td className="px-4 py-3"><div className="font-mono text-xs" title={stocktake.id}>{shortId(stocktake.id)}</div><StatusBadge tone="success">已确认</StatusBadge></td>
                      <td>{stocktake.confirmedAt ? stocktake.confirmedAt.toLocaleString("zh-CN") : "—"}</td>
                      <td className="px-4 py-3">
                        {stocktake.lines.length === 0 ? <span className="text-xs text-zinc-500">无明细</span> : stocktake.lines.map((line) => {
                          const diff = diffValue(line.countedQty, line.recordedQty);
                          return (
                            <div key={line.id} className="text-xs">
                              <span className="font-medium">{line.batch.batchNo}</span> @ {line.location.code}：{formatQty(line.recordedQty)} → {formatQty(line.countedQty)} <span className={diff === 0 ? "text-zinc-500" : diff > 0 ? "text-emerald-700" : "text-red-700"}>({signedQty(diff)})</span>
                            </div>
                          );
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {confirmedStocktakes.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">暂无已确认盘点。</p>}
          </div>
        </div>
      </section>

      <section id="loss" className={`${card} scroll-mt-24`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">损耗登记</h3>
            <p className="mt-1 text-sm text-zinc-500">登记护理损伤、过期、生产损耗等，扣减指定批次库位实存并生成 LOSS 流水与损耗单。</p>
          </div>
          <StatusBadge tone="info">库存作业 4/4</StatusBadge>
        </div>
        {!setupReady ? <MissingSetup>当前门店还没有可登记损耗的批次或库位。请先完成入库并配置库位。</MissingSetup> : (
          <form action={recordLossAction} className="mt-4 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="idempotencyKey" value={`LOSS-${crypto.randomUUID()}`} />
            <label className="block text-sm text-stone-700 md:col-span-2">
              批次 / 物料 / 库位余额
              <select className={`${input} mt-1`} name="batchId" required defaultValue="">
                <option value="" disabled>请选择批次</option>
                <BatchOptions batches={batches} />
              </select>
            </label>
            <label className="block text-sm text-stone-700">
              损耗库位
              <select className={`${input} mt-1`} name="locationId" required defaultValue="">
                <option value="" disabled>请选择库位</option>
                <LocationOptions locations={locations} totals={locationTotals} />
              </select>
            </label>
            <label className="block text-sm text-stone-700">
              损耗数量（物料基础单位）
              <input className={`${input} mt-1`} name="quantity" type="number" min="0.001" step="0.001" required placeholder="例如 1" />
              <span className="mt-1 block text-xs text-zinc-500">必须大于零，不得超过该库位实存。</span>
            </label>
            <label className="block text-sm text-stone-700">
              损耗原因
              <select className={`${input} mt-1`} name="reason" required defaultValue="CARE_DAMAGE">
                {LOSS_REASON_OPTIONS.map((reason) => (
                  <option key={reason} value={reason}>{LOSS_REASON_LABELS[reason]}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-stone-700">
              发生时间（可选）
              <input className={`${input} mt-1`} name="occurredAt" type="datetime-local" />
              <span className="mt-1 block text-xs text-zinc-500">留空则记为当前时间。</span>
            </label>
            <label className="block text-sm text-stone-700 md:col-span-2">
              备注（可选）
              <textarea className={`${input} mt-1 min-h-20`} name="note" placeholder="例如：冷柜断电导致 1 扎玫瑰受损" />
            </label>
            <div className="flex flex-wrap items-center gap-3 md:col-span-2">
              <button className={button} disabled={!setupReady}>提交损耗登记</button>
              <p className="text-xs text-zinc-500">提交后扣减库存并生成损耗单，可在下方“最近损耗记录”核对。</p>
            </div>
          </form>
        )}
        {setupReady && (
          <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-medium text-amber-950">批次不明损耗</h4>
                <p className="mt-1 text-xs text-amber-900">先提交物料、库位和数量；本店经理或授权人员确认实际批次后才会扣减库存。</p>
              </div>
              <V2DrawerForm
                triggerLabel="登记批次不明损耗"
                title="批次不明损耗"
                description="提交后进入待复核；确认实际批次前不会扣减库存。"
                action={submitUnknownBatchLossAction}
                submitLabel="提交复核（不扣库存）"
                size="md"
                triggerClassName="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                <input type="hidden" name="idempotencyKey" value={`UNKNOWN-LOSS-${crypto.randomUUID()}`} />
                <label className="block text-sm text-stone-700">物料<select className={`${input} mt-1`} name="materialId" required>{materials.map((material) => <option key={material.id} value={material.id}>{material.code} · {material.name}</option>)}</select></label>
                <label className="block text-sm text-stone-700">发现库位<select className={`${input} mt-1`} name="locationId" required><LocationOptions locations={locations} totals={locationTotals} /></select></label>
                <Field label="损耗数量" name="quantity" type="number" />
                <label className="block text-sm text-stone-700">损耗原因<select className={`${input} mt-1`} name="reason">{LOSS_REASON_OPTIONS.map((reason) => <option key={reason} value={reason}>{LOSS_REASON_LABELS[reason]}</option>)}</select></label>
                <label className="block text-sm text-stone-700">说明<input className={`${input} mt-1`} name="note" /></label>
              </V2DrawerForm>
            </div>
          </section>
        )}
        {pendingLosses.length > 0 && <div className="mt-4 space-y-2"><h4 className="text-sm font-semibold">待复核批次不明损耗</h4>{pendingLosses.map((loss) => <div key={loss.id} className="rounded-xl border border-amber-300 p-3 text-sm">
          <p>{loss.material?.code} · {loss.material?.name} · {formatQty(loss.quantity)} {loss.material?.baseUnit} · 库位 {loss.location?.code}</p>
          {canReviewInventory ? <form action={reviewUnknownBatchLossAction} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="lossRecordId" value={loss.id} />
            <select className={input} name="batchId" defaultValue=""><option value="">选择实际批次</option>{batches.filter((batch) => batch.material.code === loss.material?.code).map((batch) => <option key={batch.id} value={batch.id}>{batch.batchNo}</option>)}</select>
            <input className={input} name="note" required placeholder="复核意见" />
            <button className={button} name="decision" value="APPROVE">确认并扣减</button><button className="rounded-lg border border-red-700 px-3" name="decision" value="REJECT">拒绝</button>
          </form> : <p className="mt-1 text-xs text-amber-800">等待本店经理或授权人员复核。</p>}
        </div>)}</div>}
      </section>

      <section className={card}>
        <h3 className="font-semibold">手工入库</h3>
        <p className="mt-1 text-sm text-zinc-500">处理紧急现采和其他非采购单来源的手工入库；采购到货请在采购单页面验收。</p>
        <form action={createManualInboundAction} className="mt-4 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="idempotencyKey" value={`MANUAL-${crypto.randomUUID()}`} />
          <label className="block text-sm text-stone-700">
            物料
            <select className={`${input} mt-1`} name="materialId" required>
              {materials.map((material) => <option key={material.id} value={material.id}>{material.code} · {material.name} · {material.baseUnit}</option>)}
            </select>
          </label>
          <label className="block text-sm text-stone-700">
            入库库位
            <select className={`${input} mt-1`} name="locationId" required>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {locationKindLabel(location.kind)}</option>)}
            </select>
          </label>
          <label className="block text-sm text-stone-700">
            数量（物料基础单位）
            <input className={`${input} mt-1`} name="quantity" type="number" min="0.001" step="0.001" required placeholder="例如 10" />
          </label>
          <label className="block text-sm text-stone-700">
            最终单位成本
            <input className={`${input} mt-1`} name="unitCost" type="number" min="0" step="0.0001" defaultValue={0} required />
          </label>
          <Field label="最晚可用时间" name="usableUntil" type="datetime-local" required={false} />
          <label className="block text-sm text-stone-700">
            来源
            <select className={`${input} mt-1`} name="source">
              <option value="紧急现采">紧急现采</option>
              <option value="盘盈">盘盈</option>
              <option value="样品拆回">样品拆回</option>
              <option value="其他">其他</option>
            </select>
          </label>
          <label className="block text-sm text-stone-700 md:col-span-2">
            操作原因
            <textarea className={`${input} mt-1 min-h-20`} name="reason" required />
          </label>
          <div className="md:col-span-2">
            <button className={button} disabled={!materials.length || !locations.length}>确认入库</button>
          </div>
        </form>
        {(!materials.length || !locations.length) && <p className="mt-3 text-sm text-red-700">请先准备启用物料和门店库位。</p>}
      </section>

      <section>
        <h3 className="mb-3 font-semibold">最近库存作业流水</h3>
        <div className={tableShell}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className={tableHead}>
                <tr><th className="px-4 py-3">时间</th><th>类型</th><th>批次 / 物料</th><th>数量</th><th>从库位</th><th>到库位</th><th className="px-4">关联单据</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {recentTransactions.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">{row.createdAt.toLocaleString("zh-CN")}</td>
                    <td><StatusBadge tone={transactionTone(row.kind)}>{transactionKindLabel(row.kind)}</StatusBadge></td>
                    <td><div className="font-medium">{row.batch.batchNo}</div><div className="text-xs text-zinc-500">{row.batch.material.code} · {row.batch.material.name}</div></td>
                    <td>{formatQty(row.quantity)} {row.batch.material.baseUnit}</td>
                    <td>{row.fromLocationId ? locationCodes.get(row.fromLocationId) ?? row.fromLocationId : "—"}</td>
                    <td>{row.toLocationId ? locationCodes.get(row.toLocationId) ?? row.toLocationId : "—"}</td>
                    <td className="px-4"><div>{referenceTypeLabel(row.referenceType)}</div><div className="font-mono text-xs text-zinc-500" title={row.referenceId}>{shortId(row.referenceId)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recentTransactions.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">暂无库存调整、移库或损耗流水。</p>}
        </div>
      </section>

      <section id="loss-history" className="scroll-mt-24">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">损耗历史</h3>
          <p className="text-xs text-stone-500">共 {lossTotal} 条 · 第 {lossPage} / {lossPageCount} 页</p>
        </div>

        <form key={JSON.stringify(lossFilters)} method="get" action="/v2/operations" className={`${card} mb-4`}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5 xl:items-end">
            <label className="block text-sm text-stone-700">损耗原因
              <select className={`${input} mt-1`} name="reason" defaultValue={lossFilters.reason ?? ""}>
                <option value="">全部原因</option>
                {LOSS_REASON_OPTIONS.map((reason) => (
                  <option key={reason} value={reason}>{LOSS_REASON_LABELS[reason]}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-stone-700">复核状态
              <select className={`${input} mt-1`} name="reviewStatus" defaultValue={lossFilters.reviewStatus ?? ""}>
                <option value="">全部状态</option>
                {LOSS_REVIEW_STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-stone-700">开始日期
              <input className={`${input} mt-1`} name="from" type="date" defaultValue={lossFilters.from ?? ""} />
            </label>
            <label className="block text-sm text-stone-700">结束日期
              <input className={`${input} mt-1`} name="to" type="date" defaultValue={lossFilters.to ?? ""} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button className={button}>筛选</button>
              <Link href="/v2/operations#loss-history" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">重置</Link>
            </div>
          </div>
          <p className="mt-2 text-xs text-stone-500">日期按 Asia/Shanghai 自然日筛选，默认按发生时间倒序；每页 {LOSS_PAGE_SIZE} 条。</p>
        </form>

        <div className={tableShell}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className={tableHead}>
                <tr><th className="px-4 py-3">发生时间</th><th>损耗单</th><th>复核状态</th><th>库位</th><th>批次 / 物料</th><th>数量</th><th>原因</th><th className="px-4">备注</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {recentLosses.map((record) => {
                  const material = record.batch?.material ?? record.material;
                  return (
                    <tr key={record.id}>
                      <td className="px-4 py-3">{record.occurredAt.toLocaleString("zh-CN")}</td>
                      <td className="font-mono text-xs" title={record.id}>{shortId(record.id)}</td>
                      <td><StatusBadge tone={lossReviewStatusTone(record.reviewStatus)}>{lossReviewStatusLabel(record.reviewStatus)}</StatusBadge></td>
                      <td>{record.location?.code ?? "—"}</td>
                      <td>
                        <div className="font-medium">{record.batch?.batchNo ?? "未关联批次"}</div>
                        {material
                          ? <div className="text-xs text-zinc-500">{material.code} · {material.name}</div>
                          : <div className="text-xs text-zinc-400">物料未知</div>}
                      </td>
                      <td>{formatQty(record.quantity)} {material?.baseUnit ?? ""}</td>
                      <td>{lossReasonLabel(record.reason)}</td>
                      <td className="px-4">{record.note || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {recentLosses.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">当前筛选下没有损耗记录。</p>}
        </div>

        {lossPageCount > 1 && <nav aria-label="损耗历史分页" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
          <p className="text-stone-600">共 {lossTotal} 条 · 第 {lossPage} / {lossPageCount} 页</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {lossPage > 1
              ? <Link className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50" href={buildLossHref(lossFilters, lossPage - 1, feedback)} rel="prev">上一页</Link>
              : <span className="rounded-lg border border-stone-200 bg-stone-100 px-3 py-1.5 text-sm text-stone-400" aria-disabled="true">上一页</span>}
            {lossPageNumbers(lossPage, lossPageCount).map((number) => number === lossPage
              ? <span key={number} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white" aria-current="page">{number}</span>
              : <Link key={number} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50" href={buildLossHref(lossFilters, number, feedback)}>{number}</Link>)}
            {lossPage < lossPageCount
              ? <Link className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50" href={buildLossHref(lossFilters, lossPage + 1, feedback)} rel="next">下一页</Link>
              : <span className="rounded-lg border border-stone-200 bg-stone-100 px-3 py-1.5 text-sm text-stone-400" aria-disabled="true">下一页</span>}
          </div>
        </nav>}
      </section>

      <section>
        <h3 className="mb-3 font-semibold">最近入库记录</h3>
        <div className={tableShell}>
          <table className="w-full text-left text-sm">
            <thead className={tableHead}>
              <tr><th className="px-4 py-3">时间</th><th>批次 / 物料</th><th>数量</th><th>来源</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {recentInbound.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">{row.createdAt.toLocaleString("zh-CN")}</td>
                  <td>{row.batch.batchNo}<div className="text-xs text-zinc-500">{row.batch.material.name}</div></td>
                  <td>{formatQty(row.quantity)} {row.batch.material.baseUnit}</td>
                  <td>{row.referenceType === "MANUAL_INBOUND" ? "手工入库" : "采购验收"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentInbound.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">暂无入库记录</p>}
        </div>
      </section>
    </V2ModulePage>
  );
}
