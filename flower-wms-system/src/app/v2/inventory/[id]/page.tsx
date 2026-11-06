import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2AnyStore } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { summarizeBatchStock } from "@/v2/domain/inventory-summary";
import { StatusBadge, V2ModulePage, tableHead, tableShell } from "../../_components/V2Ui";

export const dynamic = "force-dynamic";

const kindLabels: Record<string, string> = {
  INBOUND: "入库",
  TRANSFER: "移库",
  CONSUME: "出库",
  LOSS: "损耗",
  RETURN: "退回",
  ADJUSTMENT: "调整",
  FREEZE: "冻结",
  UNFREEZE: "解冻",
};

const referenceLabels: Record<string, string> = {
  MANUAL_INBOUND: "手工入库",
  PURCHASE_RECEIPT: "采购验收",
  GOODS_RECEIPT_LINE: "采购验收",
  STOCKTAKE: "盘点确认",
  STOCKTAKE_LINE: "盘点调整",
  INVENTORY_ADJUSTMENT: "库存调整",
  INVENTORY_TRANSFER: "库位移库",
  LOSS_RECORD: "损耗登记",
  PRODUCTION_TASK: "生产领用",
};

function formatQty(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "—";
}

function availableQty(onHand: unknown, frozen: unknown): number {
  return Math.max(0, Number(onHand) - Number(frozen));
}

function kindTone(kind: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (kind === "INBOUND") return "success";
  if (kind === "LOSS") return "danger";
  if (kind === "ADJUSTMENT") return "warning";
  if (kind === "TRANSFER") return "info";
  return "neutral";
}

export default async function InventoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth(); if (!session?.user || session.user.source !== "v2") redirect("/login?callbackUrl=/v2/inventory");
  const { tenantId, storeId } = await requireV2AnyStore(["catalog", "purchase"]); const { id } = await params;
  const [material, locations, recentTransactions] = await Promise.all([
    v2db.material.findFirst({
      where: { id, tenantId },
      include: {
        batches: {
          where: { storeId },
          include: {
            balances: { include: { location: true } },
            reservations: { where: { state: "ACTIVE" }, select: { quantity: true } },
          },
          orderBy: [{ usableUntil: "asc" }, { receivedAt: "asc" }],
        },
      },
    }),
    v2db.inventoryLocation.findMany({ where: { storeId }, select: { id: true, code: true } }),
    v2db.inventoryTransaction.findMany({
      where: { batch: { materialId: id, storeId } },
      include: { batch: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  if (!material) notFound();
  const locationCodes = new Map(locations.map((location) => [location.id, location.code]));
  return <V2ModulePage
    title="库存详情 / FIFO"
    description={`${material.code} · ${material.name} · 库存单位 ${material.baseUnit}`}
    actions={<><Link className="text-sm text-emerald-700 hover:underline" href="/v2/operations#adjust">库存作业</Link><Link className="text-sm text-emerald-700 hover:underline" href="/v2/inventory">返回库存管理</Link></>}
  >
    <section>
      <h3 className="mb-3 font-semibold">FIFO 批次与库位余额</h3>
      <div className={tableShell}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className={tableHead}><tr><th className="px-4 py-3">批次</th><th>入库 / 可用期限</th><th>库位实存 / 冻结 / 可用</th><th>实存</th><th>冻结</th><th>预留</th><th>可用</th><th>成本</th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {material.batches.map((batch) => {
                const summary = summarizeBatchStock([{ onHandQty: batch.balances.reduce((s, b) => s + Number(b.onHandQty), 0), frozenQty: batch.balances.reduce((s, b) => s + Number(b.frozenQty), 0), reservedQty: batch.reservations.reduce((s, r) => s + Number(r.quantity), 0) }]);
                return <tr key={batch.id}>
                  <td className="px-4 py-3"><div className="font-medium">{batch.batchNo}</div>{summary.availableQty > 0 && <StatusBadge tone="info">FIFO 顺序</StatusBadge>}</td>
                  <td>{batch.receivedAt.toLocaleDateString("zh-CN")}<div className="text-xs text-zinc-500">{batch.usableUntil ? `可用至 ${batch.usableUntil.toLocaleDateString("zh-CN")}` : "未设置效期"}</div></td>
                  <td className="py-3">
                    {batch.balances.length === 0 ? <span className="text-zinc-500">—</span> : batch.balances.map((balance) => (
                      <div key={balance.id} className="whitespace-nowrap py-0.5 text-xs">
                        <span className="font-medium text-zinc-700">{balance.location.code}</span>
                        <span className="ml-1 text-zinc-500">实存 {formatQty(balance.onHandQty)} / 冻结 {formatQty(balance.frozenQty)} / 可用 {formatQty(availableQty(balance.onHandQty, balance.frozenQty))}</span>
                      </div>
                    ))}
                  </td>
                  <td>{summary.onHandQty}</td>
                  <td>{summary.frozenQty}</td>
                  <td>{summary.reservedQty}</td>
                  <td className="font-semibold">{summary.availableQty}</td>
                  <td>¥{Number(batch.unitCost).toFixed(4)}<div className="text-xs text-zinc-500">{batch.costEstimated ? "预计" : "最终"}</div></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {material.batches.length === 0 && <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">该物料还没有库存批次。</p>}
      </div>
      <p className="mt-2 text-xs text-zinc-400">库位可用 = 库位实存 − 库位冻结；批次可用在此基础上一并扣除有效预留，且最低为 0。</p>
    </section>

    <section>
      <h3 className="mb-3 font-semibold">最近库存流水</h3>
      <div className={tableShell}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className={tableHead}><tr><th className="px-4 py-3">时间</th><th>类型</th><th>批次</th><th>数量</th><th>从库位</th><th>到库位</th><th className="px-4">关联单据</th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {recentTransactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="px-4 py-3">{transaction.createdAt.toLocaleString("zh-CN")}</td>
                  <td><StatusBadge tone={kindTone(transaction.kind)}>{kindLabels[transaction.kind] ?? transaction.kind}</StatusBadge></td>
                  <td className="font-medium">{transaction.batch.batchNo}</td>
                  <td>{formatQty(transaction.quantity)} {material.baseUnit}</td>
                  <td>{transaction.fromLocationId ? locationCodes.get(transaction.fromLocationId) ?? transaction.fromLocationId : "—"}</td>
                  <td>{transaction.toLocationId ? locationCodes.get(transaction.toLocationId) ?? transaction.toLocationId : "—"}</td>
                  <td className="px-4"><div>{referenceLabels[transaction.referenceType] ?? transaction.referenceType}</div><div className="font-mono text-xs text-zinc-500" title={transaction.referenceId}>{transaction.referenceId.length > 12 ? `${transaction.referenceId.slice(0, 8)}…` : transaction.referenceId}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {recentTransactions.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">该物料暂无库存流水。</p>}
      </div>
    </section>
  </V2ModulePage>;
}
