import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2AnyStore } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { summarizeBatchStock } from "@/v2/domain/inventory-summary";
import { ActionEmptyState, StatusBadge, V2ModulePage, button, card, input, tableHead, tableShell } from "../_components/V2Ui";

export const dynamic = "force-dynamic";

type Params = { q?: string | string[]; stock?: string | string[] };

/** Kept outside the component so render stays free of direct impure clock reads. */
function isExpiringSoon(usableUntil: Date | null): boolean {
  if (!usableUntil) return false;
  const now = Date.now();
  const difference = usableUntil.getTime() - now;
  return difference >= 0 && difference <= 3 * 86400000;
}

const operationEntries = [
  { href: "/v2/operations#adjust", title: "库存调整", description: "盘盈 / 盘亏补录，按批次和库位增减实存。" },
  { href: "/v2/operations#transfer", title: "库位移库", description: "同一批次在仓库与加工区等库位间转移。" },
  { href: "/v2/operations#stocktake", title: "盘点", description: "创建盘点草稿，确认后按实盘数调整。" },
  { href: "/v2/operations#loss", title: "损耗登记", description: "登记护理损伤、过期、生产损耗等。" },
];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await auth(); if (!session?.user || session.user.source !== "v2") redirect("/login?callbackUrl=/v2/inventory");
  const { tenantId, storeId } = await requireV2AnyStore(["catalog", "purchase"]); const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : ""; const stock = typeof params.stock === "string" ? params.stock : "positive";
  const materials = await v2db.material.findMany({ where: { tenantId, ...(query ? { OR: [{ code: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] } : {}) }, include: { batches: { where: { storeId }, include: { balances: true, reservations: { where: { state: "ACTIVE" }, select: { quantity: true } } }, orderBy: { receivedAt: "asc" } } }, orderBy: { code: "asc" } });
  const rows = materials.map((material) => {
    const batchRows = material.batches.map((batch) => ({ onHandQty: batch.balances.reduce((s, b) => s + Number(b.onHandQty), 0), frozenQty: batch.balances.reduce((s, b) => s + Number(b.frozenQty), 0), reservedQty: batch.reservations.reduce((s, r) => s + Number(r.quantity), 0) }));
    const summary = summarizeBatchStock(batchRows); const expiring = material.batches.filter((batch, index) => isExpiringSoon(batch.usableUntil) && batchRows[index]!.onHandQty > 0).length;
    return { material, ...summary, expiring };
  }).filter((row) => stock === "all" || (stock === "zero" ? row.onHandQty <= 0 : row.onHandQty > 0));
  return <V2ModulePage title="库存管理" description="按物料汇总当前门店的实存、冻结、预留、可用库存和临期批次。" actions={<Link href="/v2/operations" className={button}>仓储日常</Link>}>
    <section aria-labelledby="inventory-operations-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="inventory-operations-heading" className="font-semibold">库存作业</h3>
          <p className="mt-1 text-sm text-zinc-500">库存调整、移库、盘点和损耗登记统一在仓储日常页面完成，操作后可在流水与损耗记录中核对。</p>
        </div>
        <Link href="/v2/operations" className="text-sm text-emerald-700 hover:underline">打开仓储日常</Link>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {operationEntries.map((entry) => (
          <Link key={entry.href} href={entry.href} className={`${card} block transition hover:border-emerald-400 hover:shadow-md`}>
            <span className="font-semibold text-emerald-800">{entry.title}</span>
            <span className="mt-1 block text-xs text-zinc-500">{entry.description}</span>
            <span className="mt-2 block text-xs font-medium text-emerald-700">去登记 →</span>
          </Link>
        ))}
      </div>
    </section>
    <form className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4"><input className={`${input} max-w-sm`} name="q" defaultValue={query} placeholder="搜索物料编码或名称" /><select className={`${input} w-40`} name="stock" defaultValue={stock}><option value="positive">有库存</option><option value="zero">零库存</option><option value="all">全部</option></select><button className={button}>查询</button></form>
    {rows.length === 0 ? <ActionEmptyState title="还没有符合条件的库存" description="可先创建采购单并验收入库，或通过仓储日常登记紧急现采和其他来源入库。" actionHref="/v2/purchase-orders" actionLabel="创建采购单" /> : <div className={tableShell}><table className="w-full text-left text-sm"><thead className={tableHead}><tr><th className="px-4 py-3">原材料名称</th><th>单位</th><th>实存</th><th>冻结</th><th>预留</th><th>可用</th><th>库存状态</th><th className="px-4">操作</th></tr></thead><tbody className="divide-y divide-zinc-100">{rows.map((row) => <tr key={row.material.id} className={row.availableQty <= 0 ? "bg-red-50/60" : row.expiring ? "bg-amber-50/60" : "hover:bg-zinc-50"}><td className="px-4 py-3"><div className="font-medium">{row.material.name}</div><div className="text-xs text-zinc-500">{row.material.code}</div></td><td>{row.material.baseUnit}</td><td>{row.onHandQty}</td><td>{row.frozenQty}</td><td>{row.reservedQty}</td><td className="font-semibold">{row.availableQty}</td><td>{row.availableQty <= 0 ? <StatusBadge tone="danger">无可用库存</StatusBadge> : row.expiring ? <StatusBadge tone="warning">临期 {row.expiring} 批</StatusBadge> : <StatusBadge tone="success">正常库存</StatusBadge>}</td><td className="px-4"><Link className="text-emerald-700 hover:underline" href={`/v2/inventory/${row.material.id}`}>库存详情 / FIFO</Link></td></tr>)}</tbody></table></div>}
    <p className="text-xs text-zinc-400">共 {rows.length} 种物料；可用量 = 实存 − 冻结 − 有效预留，按批次最低为 0。</p>
  </V2ModulePage>;
}
