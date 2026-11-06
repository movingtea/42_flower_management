import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { readV2Feedback } from "./_lib/search-params";

export const dynamic = "force-dynamic";

export default async function V2DashboardPage({ searchParams }: PageProps<"/v2">) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2");
  }
  const { tenantId, storeId } = await requireV2Store();
  // Only capped id counts are needed for the dashboard cards, so no module data is loaded here.
  const [params, materials, purchases, skus, orders] = await Promise.all([
    searchParams,
    v2db.material.findMany({ where: { tenantId }, select: { id: true }, orderBy: { code: "asc" }, take: 100 }),
    v2db.purchaseOrder.findMany({ where: { tenantId, storeId }, select: { id: true }, orderBy: { number: "desc" }, take: 20 }),
    v2db.productSku.findMany({ where: { product: { tenantId }, active: true }, select: { id: true }, orderBy: { code: "asc" }, take: 100 }),
    v2db.order.findMany({ where: { tenantId, storeId }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const feedback = readV2Feedback(params);
  const dashboardCards = [
    { href: "/v2/inventory", label: "库存管理", description: "批次、可用量、冻结、预留和效期", value: `${materials.length} 项物料` },
    { href: "/v2/purchase-orders", label: "采购单", description: "多明细采购、验收、拒收和补货关联", value: `${purchases.length} 张近期采购单` },
    { href: "/v2/catalog", label: "商品与 SKU", description: "管理商品、SKU、独立售价和启用状态", value: `${skus.length} 个在售 SKU` },
    { href: "/v2/orders", label: "订单履约", description: "人工下单、库存预留、制作、收款和配送", value: `${orders.length} 张近期订单` },
  ];
  return <main className="min-h-full bg-[#f7f7f2] px-4 py-8 text-stone-900 md:px-8"><div className="mx-auto max-w-6xl space-y-7">
    <header><p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-800">Flower Studio 2.0</p><h1 className="mt-1 text-3xl font-semibold">经营概览</h1><p className="mt-2 text-sm text-stone-600">按日常工作进入对应模块，不需要在一个长页面中来回查找。</p></header>
    {feedback.message && <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback.message}</div>}
    {feedback.error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{feedback.error}</div>}
    <div className="grid gap-4 md:grid-cols-2">{dashboardCards.map((item) => <Link key={item.href} href={item.href} className="group rounded-2xl border border-stone-200 bg-white p-6 shadow-sm transition hover:border-emerald-300 hover:shadow-md"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold group-hover:text-emerald-800">{item.label}</h2><p className="mt-2 text-sm leading-6 text-stone-600">{item.description}</p></div><span className="text-xl text-emerald-700" aria-hidden>→</span></div><p className="mt-5 text-xs font-medium text-stone-500">{item.value}</p></Link>)}</div>
  </div></main>;
}
