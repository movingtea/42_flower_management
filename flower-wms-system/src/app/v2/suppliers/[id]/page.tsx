import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { PurchaseState } from "@/generated/prisma-v2/client";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { StatusBadge, V2ModulePage, card, tableHead, tableShell } from "../../_components/V2Ui";

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  ORDERED: "已下单",
  PARTIALLY_RECEIVED: "部分验收",
  RECEIVED: "已处理",
  CANCELLED: "已取消",
};

const STATE_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  ORDERED: "info",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "danger",
};

const OPEN_STATES: ReadonlySet<PurchaseState> = new Set([PurchaseState.DRAFT, PurchaseState.ORDERED, PurchaseState.PARTIALLY_RECEIVED]);

function money(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function formatDate(value: Date | null): string {
  return value ? value.toLocaleDateString("zh-CN") : "—";
}

function formatDateTime(value: Date): string {
  return value.toLocaleString("zh-CN");
}

function purchaseOrderHref(supplierId: string, number: string): string {
  const params = new URLSearchParams({ q: number, state: "all", supplierId });
  return `/v2/purchase-orders?${params.toString()}`;
}

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") redirect("/login?callbackUrl=/v2/suppliers");
  const { tenantId, storeId } = await requireV2Store("purchase");
  const { id } = await params;

  const supplier = await v2db.supplier.findFirst({
    where: { id, tenantId },
    include: {
      purchases: {
        where: { storeId },
        include: {
          lines: { select: { orderedQty: true, unitPrice: true } },
        },
        orderBy: [{ createdAt: "desc" }, { number: "desc" }],
      },
    },
  });
  if (!supplier) notFound();

  const purchases = supplier.purchases;
  const openPurchases = purchases.filter((purchase) => OPEN_STATES.has(purchase.state));
  const spendTotal = purchases
    .filter((purchase) => purchase.state !== PurchaseState.CANCELLED)
    .reduce((total, purchase) => {
      const lineTotal = purchase.lines.reduce(
        (sum, line) => sum + Number(line.orderedQty) * Number(line.unitPrice),
        0,
      );
      return total + lineTotal + Number(purchase.freightCost) + Number(purchase.packagingCost) + Number(purchase.otherCost);
    }, 0);
  const history = purchases.slice(0, 100);

  return <V2ModulePage
    title={supplier.name}
    description={`供应商编码 ${supplier.code}${supplier.active ? "" : " · 已停用"} · 采购历史按当前门店统计`}
    actions={<>
      <Link className="text-sm text-emerald-700 hover:underline" href="/v2/suppliers">返回供应商</Link>
      <Link className="text-sm text-emerald-700 hover:underline" href={`/v2/purchase-orders?supplierId=${encodeURIComponent(supplier.id)}&state=all`}>在采购单中筛选</Link>
    </>}
  >
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">供应商档案</h2>
          <p className="mt-1 text-sm text-stone-600">联系方式用于采购沟通；停用后仍保留全部历史采购引用。</p>
        </div>
        <StatusBadge tone={supplier.active ? "success" : "neutral"}>{supplier.active ? "启用" : "停用"}</StatusBadge>
      </div>
      <div className="mt-4 grid gap-3 rounded-lg bg-zinc-50 p-4 text-sm md:grid-cols-3">
        <div>联系人<br /><strong>{supplier.contactName || "—"}</strong></div>
        <div>联系电话<br /><strong>{supplier.phone || "—"}</strong></div>
        <div>微信<br /><strong>{supplier.wechat || "—"}</strong></div>
        <div>创建时间<br /><strong>{formatDateTime(supplier.createdAt)}</strong></div>
        <div>最近更新<br /><strong>{formatDateTime(supplier.updatedAt)}</strong></div>
        <div className="md:col-span-3">备注<br /><strong className="font-normal text-stone-700">{supplier.notes || "未填写"}</strong></div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-xs text-stone-500">采购单总数</div>
          <div className="mt-1 text-2xl font-semibold">{purchases.length}</div>
          <div className="mt-1 text-xs text-stone-500">含已取消单据</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs text-amber-800">未完成采购单</div>
          <div className="mt-1 text-2xl font-semibold text-amber-950">{openPurchases.length}</div>
          <div className="mt-1 text-xs text-amber-800">草稿、已下单、部分验收</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-xs text-emerald-800">非取消采购金额</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-950">¥{money(spendTotal)}</div>
          <div className="mt-1 text-xs text-emerald-800">含运费、包装费和其他费用</div>
        </div>
      </div>
    </section>

    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-semibold">采购历史</h3>
          <p className="mt-1 text-sm text-zinc-500">
            最近 {history.length} 张采购单，按创建时间倒序；金额包含运费、包装费和其他费用。
          </p>
        </div>
        <Link className="text-sm text-emerald-700 hover:underline" href={`/v2/purchase-orders?supplierId=${encodeURIComponent(supplier.id)}&state=all`}>
          查看该供应商全部采购单 →
        </Link>
      </div>
      <div className={tableShell}>
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className={tableHead}>
            <tr>
              <th className="px-4 py-3">采购单号</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>预计到货</th>
              <th>明细行</th>
              <th className="px-4">金额</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {history.map((purchase) => {
              const lineTotal = purchase.lines.reduce(
                (sum, line) => sum + Number(line.orderedQty) * Number(line.unitPrice),
                0,
              );
              const fees = Number(purchase.freightCost) + Number(purchase.packagingCost) + Number(purchase.otherCost);
              const amount = lineTotal + fees;
              return <tr key={purchase.id} className="align-top hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <Link className="font-medium text-emerald-700 hover:underline" href={purchaseOrderHref(supplier.id, purchase.number)}>
                    {purchase.number}
                  </Link>
                  {purchase.notes && <div className="mt-1 max-w-xs truncate text-xs text-zinc-400">{purchase.notes}</div>}
                </td>
                <td><StatusBadge tone={STATE_TONE[purchase.state] ?? "neutral"}>{STATE_LABEL[purchase.state] ?? purchase.state}</StatusBadge></td>
                <td>{formatDateTime(purchase.createdAt)}</td>
                <td>{formatDate(purchase.expectedAt)}</td>
                <td>{purchase.lines.length} 行</td>
                <td className="px-4">
                  ¥{money(amount)}
                  <div className="text-xs text-zinc-500">明细 ¥{money(lineTotal)} · 费用 ¥{money(fees)}</div>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
        {history.length === 0 && <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">该供应商在当前门店还没有采购记录。</p>}
      </div>
      {purchases.length > history.length && <p className="mt-2 text-xs text-zinc-400">仅展示最近 100 张采购单；如需更早记录，请使用采购单页面的搜索和筛选。</p>}
    </section>
  </V2ModulePage>;
}
