import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { MaterialKind } from "@/generated/prisma-v2/client";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { ActionEmptyState, Field, StatusBadge, V2ModulePage, button, input, tableHead, tableShell } from "../_components/V2Ui";
import { readV2Feedback } from "../_lib/search-params";
import { createMaterialAction, setMaterialActiveAction, updateMaterialAction } from "./actions";

export const dynamic = "force-dynamic";
const KIND_LABEL: Record<string, string> = { FLOWER: "花材", FOLIAGE: "叶材", PACKAGING: "包装", CONSUMABLE: "耗材", OTHER: "其他" };

function MaterialFields({ material }: { material?: { code: string; name: string; kind: MaterialKind; color: string | null; grade: string | null; gradeSpecification: string | null; specification: string | null; baseUnit: string; quantityScale: number; reservePerOrder: boolean } }) {
  return <div className="grid gap-3 md:grid-cols-2">
    <Field label="物料编码" name="code" defaultValue={material?.code} />
    <Field label="物料名称" name="name" defaultValue={material?.name} />
    <label className="text-sm text-zinc-700">物料类别<select className={`${input} mt-1`} name="kind" defaultValue={material?.kind ?? "FLOWER"}>{Object.values(MaterialKind).map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}</select></label>
    <Field label="颜色" name="color" required={false} defaultValue={material?.color ?? ""} />
    <Field label="品质等级" name="grade" required={false} defaultValue={material?.grade ?? ""} />
    <Field label="等级说明（如长度范围）" name="gradeSpecification" required={false} defaultValue={material?.gradeSpecification ?? ""} />
    <Field label="规格" name="specification" required={false} defaultValue={material?.specification ?? ""} />
    <Field label="库存单位" name="baseUnit" defaultValue={material?.baseUnit ?? "支"} />
    <Field label="库存小数位数" name="quantityScale" type="number" defaultValue={material?.quantityScale ?? 0} />
    <label className="flex items-center gap-2 text-sm text-zinc-700 md:col-span-2"><input type="checkbox" name="reservePerOrder" defaultChecked={material?.reservePerOrder ?? true} /> 按订单预留库存</label>
  </div>;
}

export default async function MaterialsPage({ searchParams }: PageProps<"/v2/materials">) {
  const session = await auth(); if (!session?.user || session.user.source !== "v2") redirect("/login?callbackUrl=/v2/materials");
  const { tenantId } = await requireV2Store("catalog");
  const params = await searchParams; const query = typeof params.q === "string" ? params.q.trim() : ""; const state = typeof params.state === "string" ? params.state : "active";
  const materials = await v2db.material.findMany({ where: { tenantId, ...(state === "all" ? {} : { active: state !== "inactive" }), ...(query ? { OR: [{ code: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] } : {}) }, orderBy: [{ active: "desc" }, { code: "asc" }] });
  const feedback = readV2Feedback(params);
  return <V2ModulePage title="物料母表" description="维护花材、叶材、包装与耗材的身份、品质等级、规格和库存计量规则。" message={feedback.message} error={feedback.error} actions={<details className="relative"><summary className={`${button} cursor-pointer list-none`}>新增物料</summary><div className="absolute right-0 z-20 mt-2 w-[min(42rem,90vw)] rounded-xl border border-zinc-200 bg-white p-5 shadow-xl"><form action={createMaterialAction} className="space-y-4"><h3 className="font-semibold">新增物料</h3><MaterialFields /><button className={button}>保存物料</button></form></div></details>}>
    <form className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4"><input className={`${input} max-w-sm`} name="q" defaultValue={query} placeholder="搜索编码或物料名称" /><select className={`${input} w-36`} name="state" defaultValue={state}><option value="active">启用</option><option value="inactive">已停用</option><option value="all">全部</option></select><button className={button}>查询</button></form>
    {materials.length === 0 ? <ActionEmptyState title="还没有符合条件的物料" description="新增第一条物料规格，或调整搜索和状态筛选。" /> : <div className={tableShell}><table className="w-full text-left text-sm"><thead className={tableHead}><tr><th className="px-4 py-3">编码 / 名称</th><th>类别</th><th>品质与规格</th><th>库存单位</th><th>状态</th><th className="px-4">操作</th></tr></thead><tbody className="divide-y divide-zinc-100">{materials.map((item) => <tr key={item.id} className={item.active ? "hover:bg-zinc-50" : "bg-zinc-50 text-zinc-500"}><td className="px-4 py-3"><div className="font-medium text-zinc-900">{item.name}</div><div className="text-xs text-zinc-500">{item.code}</div></td><td>{KIND_LABEL[item.kind]}</td><td>{[item.color, item.grade, item.gradeSpecification, item.specification].filter(Boolean).join(" · ") || "—"}</td><td>{item.baseUnit} · {item.quantityScale === 0 ? "整数" : `${item.quantityScale} 位小数`}<div className="text-xs text-zinc-500">{item.reservePerOrder ? "逐单预留" : "不逐单预留"}</div></td><td><StatusBadge tone={item.active ? "success" : "neutral"}>{item.active ? "启用" : "停用"}</StatusBadge></td><td className="px-4"><details><summary className="cursor-pointer text-emerald-700">编辑</summary><form action={updateMaterialAction} className="mt-3 w-[min(42rem,75vw)] space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg"><input type="hidden" name="materialId" value={item.id} /><MaterialFields material={item} /><button className={button}>保存修改</button></form></details><form action={setMaterialActiveAction} className="mt-2"><input type="hidden" name="materialId" value={item.id} /><input type="hidden" name="active" value={String(!item.active)} /><button className="text-xs text-zinc-600 underline">{item.active ? "停用" : "重新启用"}</button></form></td></tr>)}</tbody></table></div>}
    <p className="text-xs text-zinc-400">共 {materials.length} 条物料规格。丝带、胶带按“卷”管理；花泥按具体规格建物料并使用整数库存。</p>
  </V2ModulePage>;
}
