import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { MaterialKind } from "@/generated/prisma-v2/client";
import { parseStoredCareDocument } from "@/lib/wiki-care";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { ActionEmptyState, Field, StatusBadge, V2ModulePage, button, input, tableHead, tableShell } from "../_components/V2Ui";
import { V2ImagePreview } from "../_components/V2Image";
import { readV2Feedback } from "../_lib/search-params";
import { createMaterialAction, setMaterialActiveAction, updateMaterialAction } from "./actions";
import { MaterialKnowledgeEditor, type MaterialKnowledgeEditorValue } from "./MaterialKnowledgeEditor";

export const dynamic = "force-dynamic";
const KIND_LABEL: Record<string, string> = { FLOWER: "花材", FOLIAGE: "叶材", PACKAGING: "包装", CONSUMABLE: "耗材", OTHER: "其他" };

type DecimalLike = { toString(): string } | string | null | undefined;

type MaterialRow = {
  id: string;
  code: string;
  name: string;
  kind: MaterialKind;
  color: string | null;
  grade: string | null;
  gradeSpecification: string | null;
  specification: string | null;
  baseUnit: string;
  quantityScale: number;
  reservePerOrder: boolean;
  englishName: string | null;
  flowerLanguage: string | null;
  maintenance: string | null;
  maintenanceCare: unknown;
  supplySeason: string | null;
  defaultShelfLifeDays: number | null;
  standardUnitCost: { toString(): string } | null;
  costUnit: string | null;
  costNote: string | null;
  optimisticUsableRate: { toString(): string } | null;
  standardUsableRate: { toString(): string } | null;
  conservativeUsableRate: { toString(): string } | null;
  lossRateNote: string | null;
  brand: string | null;
  model: string | null;
  notes: string | null;
  imageKey: string | null;
  safetyStockThreshold: { toString(): string };
  categories: Array<{
    categoryId: string;
    category: { id: string; name: string; active: boolean };
  }>;
};

type MaterialFieldsValue = Pick<
  MaterialRow,
  "code" | "name" | "kind" | "color" | "grade" | "gradeSpecification" | "specification" | "baseUnit" | "quantityScale" | "reservePerOrder"
>;

function decimalText(value: DecimalLike): string | null {
  if (value == null) return null;
  const text = typeof value === "string" ? value : value.toString();
  return text.trim() || null;
}

function formatPercent(value: DecimalLike): string {
  const raw = decimalText(value);
  if (raw === null) return "未设置";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "未设置";
  return `${Number((parsed * 100).toFixed(2))}%`;
}

function formatMoney(item: Pick<MaterialRow, "standardUnitCost" | "costUnit">): string {
  const raw = decimalText(item.standardUnitCost);
  if (raw === null) return "未设置";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "未设置";
  return `¥${parsed.toFixed(2)} / ${item.costUnit || "支"}`;
}

function toKnowledgeValue(item: MaterialRow): MaterialKnowledgeEditorValue {
  return {
    englishName: item.englishName,
    flowerLanguage: item.flowerLanguage,
    maintenance: item.maintenance,
    maintenanceCare: item.maintenanceCare,
    supplySeason: item.supplySeason,
    defaultShelfLifeDays: item.defaultShelfLifeDays,
    standardUnitCost: decimalText(item.standardUnitCost),
    costUnit: item.costUnit,
    costNote: item.costNote,
    optimisticUsableRate: decimalText(item.optimisticUsableRate),
    standardUsableRate: decimalText(item.standardUsableRate),
    conservativeUsableRate: decimalText(item.conservativeUsableRate),
    lossRateNote: item.lossRateNote,
    brand: item.brand,
    model: item.model,
    notes: item.notes,
    imageKey: item.imageKey,
    safetyStockThreshold: decimalText(item.safetyStockThreshold),
    categoryIds: item.categories.map((relation) => relation.categoryId),
  };
}

function MaterialFields({ material }: { material?: MaterialFieldsValue }) {
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

function KnowledgeDetails({ item }: { item: MaterialRow }) {
  const careRows = parseStoredCareDocument(item.maintenanceCare)?.filter((row) => row.value.trim()) ?? [];
  const careText = careRows.length > 0
    ? careRows.map((row) => `${row.label}：${row.value.trim()}`).join("\n")
    : item.maintenance;
  const standardRate = decimalText(item.standardUsableRate);
  const lossText = standardRate !== null && Number.isFinite(Number(standardRate))
    ? `${formatPercent(item.standardUsableRate)}（损耗 ${formatPercent(String(1 - Number(standardRate)))}）`
    : "未设置";

  return <details className="mt-1 text-xs">
    <summary className="cursor-pointer text-emerald-700">知识资料</summary>
    <div className="mt-2 space-y-1 rounded-lg bg-zinc-50 p-2 text-zinc-600">
      {item.englishName && <div><span className="text-zinc-400">学名 / 英文名：</span>{item.englishName}</div>}
      {item.flowerLanguage && <div><span className="text-zinc-400">花语：</span>{item.flowerLanguage}</div>}
      {careText && <div><span className="text-zinc-400">养护：</span><span className="whitespace-pre-line">{careText}</span></div>}
      <div><span className="text-zinc-400">成本：</span>{formatMoney(item)}</div>
      <div><span className="text-zinc-400">标准可用率 / 损耗率：</span>{lossText}</div>
      <div><span className="text-zinc-400">可用率区间：</span>乐观 {formatPercent(item.optimisticUsableRate)} · 标准 {formatPercent(item.standardUsableRate)} · 保守 {formatPercent(item.conservativeUsableRate)}</div>
      <div><span className="text-zinc-400">供货周期：</span>{item.supplySeason || "—"}<span className="mx-2 text-zinc-300">|</span><span className="text-zinc-400">保质期：</span>{item.defaultShelfLifeDays != null ? `${item.defaultShelfLifeDays} 天` : "—"}</div>
      {(item.brand || item.model) && <div><span className="text-zinc-400">品牌 / 型号：</span>{[item.brand, item.model].filter(Boolean).join(" / ")}</div>}
      {item.costNote && <div><span className="text-zinc-400">成本备注：</span>{item.costNote}</div>}
      {item.lossRateNote && <div><span className="text-zinc-400">损耗说明：</span>{item.lossRateNote}</div>}
      {item.notes && <div><span className="text-zinc-400">备注：</span>{item.notes}</div>}
      <div><span className="text-zinc-400">安全库存阈值：</span>{decimalText(item.safetyStockThreshold) ?? "0"}</div>
    </div>
  </details>;
}

export default async function MaterialsPage({ searchParams }: PageProps<"/v2/materials">) {
  const session = await auth(); if (!session?.user || session.user.source !== "v2") redirect("/login?callbackUrl=/v2/materials");
  const { tenantId } = await requireV2Store("catalog");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const state = typeof params.state === "string" ? params.state : "active";
  const category = typeof params.category === "string" ? params.category.trim() : "";

  const [categories, materials] = await Promise.all([
    v2db.materialCategory.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, active: true },
    }),
    v2db.material.findMany({
      where: {
        tenantId,
        ...(state === "all" ? {} : { active: state !== "inactive" }),
        ...(query ? { OR: [{ code: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }, { englishName: { contains: query, mode: "insensitive" } }] } : {}),
        ...(category ? { categories: { some: { categoryId: category } } } : {}),
      },
      include: { categories: { include: { category: { select: { id: true, name: true, active: true } } } } },
      orderBy: [{ active: "desc" }, { code: "asc" }],
    }),
  ]);
  const feedback = readV2Feedback(params);

  return <V2ModulePage title="物料母表" description="维护花材、叶材、包装与耗材的身份、品质等级、规格、V1 知识资料与库存计量规则。" message={feedback.message} error={feedback.error} actions={<details className="relative"><summary className={`${button} cursor-pointer list-none`}>新增物料</summary><div className="absolute right-0 z-20 mt-2 max-h-[85vh] w-[min(60rem,95vw)] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-xl"><form action={createMaterialAction} className="space-y-4"><h3 className="font-semibold">新增物料</h3><MaterialFields /><MaterialKnowledgeEditor categories={categories} /><button className={button}>保存物料</button></form></div></details>}>
    <form className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4">
      <input className={`${input} max-w-sm`} name="q" defaultValue={query} placeholder="搜索编码、名称或拉丁名 / 英文名" />
      <select className={`${input} w-44`} name="category" defaultValue={category}><option value="">全部分类</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select className={`${input} w-36`} name="state" defaultValue={state}><option value="active">启用</option><option value="inactive">已停用</option><option value="all">全部</option></select>
      <button className={button}>查询</button>
    </form>
    {materials.length === 0 ? <ActionEmptyState title="还没有符合条件的物料" description="新增第一条物料规格，或调整搜索和分类筛选。" /> : <div className={tableShell}><table className="w-full text-left text-sm"><thead className={tableHead}><tr><th className="px-3 py-3">图片</th><th className="px-4 py-3">编码 / 名称</th><th>类别</th><th>品质与规格</th><th>库存单位</th><th>状态</th><th className="px-4">操作</th></tr></thead><tbody className="divide-y divide-zinc-100">{materials.map((item) => <tr key={item.id} className={item.active ? "hover:bg-zinc-50" : "bg-zinc-50 text-zinc-500"}><td className="px-3 py-3"><V2ImagePreview stored={item.imageKey} alt={item.name} compact className="h-14 w-14" /></td><td className="px-4 py-3"><div className="font-medium text-zinc-900">{item.name}</div><div className="text-xs text-zinc-500">{item.code}</div>{item.categories.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{item.categories.map((relation) => <span key={relation.categoryId} className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${relation.category.active ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-500"}`}>{relation.category.name}</span>)}</div>}<KnowledgeDetails item={item} /></td><td>{KIND_LABEL[item.kind]}</td><td>{[item.color, item.grade, item.gradeSpecification, item.specification].filter(Boolean).join(" · ") || "—"}</td><td>{item.baseUnit} · {item.quantityScale === 0 ? "整数" : `${item.quantityScale} 位小数`}<div className="text-xs text-zinc-500">{item.reservePerOrder ? "逐单预留" : "不逐单预留"}</div></td><td><StatusBadge tone={item.active ? "success" : "neutral"}>{item.active ? "启用" : "停用"}</StatusBadge></td><td className="px-4"><details><summary className="cursor-pointer text-emerald-700">编辑</summary><form action={updateMaterialAction} className="mt-3 w-[min(60rem,75vw)] space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg"><input type="hidden" name="materialId" value={item.id} /><MaterialFields material={item} /><MaterialKnowledgeEditor material={toKnowledgeValue(item)} categories={categories} /><button className={button}>保存修改</button></form></details><form action={setMaterialActiveAction} className="mt-2"><input type="hidden" name="materialId" value={item.id} /><input type="hidden" name="active" value={String(!item.active)} /><button className="text-xs text-zinc-600 underline">{item.active ? "停用" : "重新启用"}</button></form></td></tr>)}</tbody></table></div>}
    <p className="text-xs text-zinc-400">共 {materials.length} 条物料规格。丝带、胶带按“卷”管理；花泥按具体规格建物料并使用整数库存。</p>
  </V2ModulePage>;
}
