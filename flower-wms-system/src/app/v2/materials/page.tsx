import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FloralRole, LossMode, MaterialKind } from "@/generated/prisma-v2/client";
import { formatDateTime } from "@/lib/format-display";
import { parseStoredCareDocument } from "@/lib/wiki-care";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { ActionEmptyState, Field, StatusBadge, V2ModulePage, button, input, tableHead, tableShell } from "../_components/V2Ui";
import { V2DrawerForm } from "../_components/V2Drawer";
import { V2ImagePreview } from "../_components/V2Image";
import { readV2Feedback } from "../_lib/search-params";
import {
  createMaterialAction,
  deleteMaterialAction,
  setMaterialActiveAction,
  updateMaterialAction,
  updateMaterialStandardCostAction,
} from "./actions";
import { MaterialKnowledgeEditor, type MaterialKnowledgeEditorValue } from "./MaterialKnowledgeEditor";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { FLOWER: "花材", FOLIAGE: "叶材", PACKAGING: "包装", CONSUMABLE: "耗材", OTHER: "其他" };
const FLORAL_ROLE_LABEL: Record<string, string> = { MAIN: "主花", FILLER: "配花", LINE: "线状花", FOLIAGE: "叶材" };
const LOSS_MODE_LABEL: Record<string, string> = { OPTIMISTIC: "乐观", STANDARD: "标准", CONSERVATIVE: "保守" };

type DecimalLike = { toString(): string } | string | null | undefined;

type MaterialRow = {
  id: string;
  code: string;
  name: string;
  kind: MaterialKind;
  color: string | null;
  floralRole: string | null;
  colorTags: string[];
  pinyinIndex: string;
  aliasText: string;
  aliasMap: unknown;
  morphology: string | null;
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
  standardUnitCost: DecimalLike;
  costUnit: string | null;
  costNote: string | null;
  costUpdatedAt: Date | null;
  optimisticUsableRate: DecimalLike;
  standardUsableRate: DecimalLike;
  conservativeUsableRate: DecimalLike;
  defaultUsableRate: DecimalLike;
  defaultLossRate: DecimalLike;
  lossMode: string;
  lossRateUpdatedAt: Date | null;
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

/** Stored 0–1 rate → the 0–100 percentage text the form edits. */
function ratePercentText(value: DecimalLike): string {
  const raw = decimalText(value);
  if (raw === null) return "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "";
  return String(Number((parsed * 100).toFixed(4)));
}

/** `{ zh: [...] }` → comma separated text for the single aliases input. */
function aliasListText(aliasMap: unknown): string {
  if (!aliasMap || typeof aliasMap !== "object" || Array.isArray(aliasMap)) return "";
  const aliases: string[] = [];
  for (const entry of Object.values(aliasMap as Record<string, unknown>)) {
    if (!Array.isArray(entry)) continue;
    for (const alias of entry) {
      if (typeof alias !== "string") continue;
      const trimmed = alias.trim();
      if (trimmed && !aliases.includes(trimmed)) aliases.push(trimmed);
    }
  }
  return aliases.join("，");
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

/**
 * Identity fields (`编号` is system generated). The same component renders the
 * create and edit drawers; the edit drawer additionally shows the read-only
 * identifier, timestamps and the stored pinyin index.
 */
function MaterialIdentityFields({ material }: { material?: MaterialRow }) {
  return <div className="grid gap-3 md:grid-cols-2">
    {material && <div className="md:col-span-2 rounded-lg bg-zinc-50 px-3 py-2">
      <div className="text-xs text-zinc-500">物料编号</div>
      <div className="font-mono text-sm text-zinc-900">{material.code}</div>
      <div className="mt-1 text-xs text-zinc-400">系统自动生成，不可修改；拼音索引 {material.pinyinIndex || "—"}（{material.aliasText ? `别名 ${material.aliasText}` : "无别名"}）</div>
    </div>}
    <Field label="物料名称" name="name" defaultValue={material?.name} />
    <label className="block text-sm text-stone-700">物料类别<select className={`${input} mt-1`} name="kind" defaultValue={material?.kind ?? "FLOWER"}>{Object.values(MaterialKind).map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}</select></label>
    <label className="block text-sm text-stone-700">花材角色<select className={`${input} mt-1`} name="floralRole" defaultValue={material?.floralRole ?? ""}><option value="">未设置</option>{Object.values(FloralRole).map((role) => <option key={role} value={role}>{FLORAL_ROLE_LABEL[role] ?? role}</option>)}</select></label>
    <Field label="颜色标签（逗号分隔，最多 20 个）" name="colorTags" required={false} defaultValue={material?.colorTags.join("，") ?? ""} />
    <Field label="颜色" name="color" required={false} defaultValue={material?.color ?? ""} />
    <Field label="品质等级" name="grade" required={false} defaultValue={material?.grade ?? ""} />
    <Field label="等级说明（如长度范围）" name="gradeSpecification" required={false} defaultValue={material?.gradeSpecification ?? ""} />
    <Field label="规格" name="specification" required={false} defaultValue={material?.specification ?? ""} />
    <Field label="库存单位" name="baseUnit" defaultValue={material?.baseUnit ?? "支"} />
    <Field label="库存小数位数" name="quantityScale" type="number" defaultValue={material?.quantityScale ?? 0} />
    <label className="block text-sm text-stone-700">别名（中文别名，逗号分隔，最多 20 个）<input className={`${input} mt-1`} name="aliases" maxLength={800} defaultValue={aliasListText(material?.aliasMap)} placeholder="如：玫瑰，月季，刺玫" /></label>
    <label className="block text-sm text-stone-700 md:col-span-2">形态特征<textarea className={`${input} mt-1 min-h-16`} name="morphology" maxLength={200} defaultValue={material?.morphology ?? ""} placeholder="如：花头饱满、花瓣层叠、茎粗直，最多 200 字" /></label>
    <label className="flex items-center gap-2 text-sm text-stone-700 md:col-span-2"><input type="checkbox" name="reservePerOrder" defaultChecked={material?.reservePerOrder ?? true} /> 按订单预留库存</label>
    <label className="block text-sm text-stone-700">默认可用率（%）<input className={`${input} mt-1`} name="defaultUsableRate" type="number" min={0} max={100} step={0.01} defaultValue={ratePercentText(material?.defaultUsableRate)} placeholder="如 85" /></label>
    <label className="block text-sm text-stone-700">默认损耗率（%）<input className={`${input} mt-1`} name="defaultLossRate" type="number" min={0} max={100} step={0.01} defaultValue={ratePercentText(material?.defaultLossRate)} placeholder="如 15" /></label>
    <label className="block text-sm text-stone-700">损耗模式<select className={`${input} mt-1`} name="lossMode" defaultValue={material?.lossMode ?? "STANDARD"}>{Object.values(LossMode).map((mode) => <option key={mode} value={mode}>{LOSS_MODE_LABEL[mode] ?? mode}</option>)}</select></label>
    {material && <div className="md:col-span-2 space-y-0.5 text-xs text-zinc-500">
      <div>标准成本更新时间：{formatDateTime(material.costUpdatedAt)}</div>
      <div>损耗率更新时间：{formatDateTime(material.lossRateUpdatedAt)}</div>
    </div>}
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
      {item.morphology && <div><span className="text-zinc-400">形态特征：</span>{item.morphology}</div>}
      {careText && <div><span className="text-zinc-400">养护：</span><span className="whitespace-pre-line">{careText}</span></div>}
      <div><span className="text-zinc-400">成本：</span>{formatMoney(item)}</div>
      <div><span className="text-zinc-400">标准可用率 / 损耗率：</span>{lossText}</div>
      <div><span className="text-zinc-400">可用率区间：</span>乐观 {formatPercent(item.optimisticUsableRate)} · 标准 {formatPercent(item.standardUsableRate)} · 保守 {formatPercent(item.conservativeUsableRate)}</div>
      <div><span className="text-zinc-400">默认可用率 / 默认损耗率：</span>{formatPercent(item.defaultUsableRate)} / {formatPercent(item.defaultLossRate)}（{LOSS_MODE_LABEL[item.lossMode] ?? item.lossMode}模式）</div>
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
  const role = typeof params.role === "string" ? params.role.trim() : "";
  const color = typeof params.color === "string" ? params.color.trim() : "";
  const floralRoleFilter = (Object.values(FloralRole) as readonly string[]).includes(role) ? role : "";

  const [categories, materials, colorTagRows] = await Promise.all([
    v2db.materialCategory.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, active: true },
    }),
    v2db.material.findMany({
      where: {
        tenantId,
        ...(state === "all" ? {} : { active: state !== "inactive" }),
        ...(query ? { OR: [
          { code: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
          { englishName: { contains: query, mode: "insensitive" } },
          { pinyinIndex: { contains: query.toLowerCase(), mode: "insensitive" } },
          { aliasText: { contains: query, mode: "insensitive" } },
        ] } : {}),
        ...(category ? { categories: { some: { categoryId: category } } } : {}),
        ...(floralRoleFilter ? { floralRole: floralRoleFilter as FloralRole } : {}),
        ...(color ? { colorTags: { has: color } } : {}),
      },
      include: { categories: { include: { category: { select: { id: true, name: true, active: true } } } } },
      orderBy: [{ active: "desc" }, { code: "asc" }],
    }),
    v2db.material.findMany({
      where: { tenantId, active: true },
      select: { colorTags: true },
      take: 500,
    }),
  ]);
  const colorOptions = [...new Set(colorTagRows.flatMap((row) => row.colorTags))].sort((left, right) => left.localeCompare(right, "zh"));
  const feedback = readV2Feedback(params);
  const hasFilters = Boolean(query || category || floralRoleFilter || color || state !== "active");

  return <V2ModulePage
    title="物料母表"
    description="维护花材、叶材、包装与耗材的身份、角色、颜色、形态、别名、知识资料与库存计量规则；编号由系统自动生成。"
    message={feedback.message}
    error={feedback.error}
    actions={<V2DrawerForm
      triggerLabel="新增物料"
      title="新增物料"
      description="物料编号由系统自动生成（MAT-日期-随机码），无需手工填写。"
      action={createMaterialAction}
      submitLabel="保存物料"
      size="xl"
      triggerClassName={button}
      footerNote="保存后可在列表用「编辑」继续补充知识资料。"
    >
      <MaterialIdentityFields />
      <MaterialKnowledgeEditor categories={categories} />
    </V2DrawerForm>}
  >
    <form className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4">
      <input className={`${input} max-w-sm`} name="q" defaultValue={query} placeholder="搜索编号、名称、英文名、拼音简拼或别名" />
      <select className={`${input} w-40`} name="role" defaultValue={floralRoleFilter}><option value="">全部角色</option>{Object.values(FloralRole).map((value) => <option key={value} value={value}>{FLORAL_ROLE_LABEL[value] ?? value}</option>)}</select>
      <select className={`${input} w-36`} name="color" defaultValue={color}><option value="">全部颜色</option>{colorOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select className={`${input} w-44`} name="category" defaultValue={category}><option value="">全部分类</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select className={`${input} w-36`} name="state" defaultValue={state}><option value="active">启用</option><option value="inactive">已停用</option><option value="all">全部</option></select>
      <button className={button}>查询</button>
    </form>

    {materials.length === 0
      ? <ActionEmptyState
        title={hasFilters ? "没有符合条件的物料" : "还没有物料"}
        description={hasFilters ? "调整搜索关键词、角色、颜色或分类筛选后再试。" : "新增第一条物料规格，再补充配方与库存计量规则。"}
      />
      : <div className={tableShell}><table className="w-full text-left text-sm">
        <thead className={tableHead}><tr>
          <th className="px-3 py-3">图片</th>
          <th className="px-4 py-3">编号</th>
          <th className="px-4 py-3">名称</th>
          <th>类别 / 角色</th>
          <th>颜色</th>
          <th>品质与规格</th>
          <th>库存单位</th>
          <th>状态</th>
          <th className="px-4">操作</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-100">
          {materials.map((item) => <tr key={item.id} className={item.active ? "align-top hover:bg-zinc-50" : "align-top bg-zinc-50 text-zinc-500"}>
            <td className="px-3 py-3"><V2ImagePreview stored={item.imageKey} alt={item.name} compact className="h-14 w-14" /></td>
            <td className="px-4 py-3"><div className="font-mono text-xs text-zinc-700">{item.code}</div><div className="mt-1 text-xs text-zinc-400">{item.pinyinIndex || "—"}</div></td>
            <td className="px-4 py-3">
              <div className="font-medium text-zinc-900">{item.name}</div>
              {item.englishName && <div className="text-xs text-zinc-500">{item.englishName}</div>}
              {item.aliasText && <div className="mt-1 text-xs text-zinc-400">别名：{item.aliasText}</div>}
              {item.categories.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{item.categories.map((relation) => <span key={relation.categoryId} className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${relation.category.active ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-500"}`}>{relation.category.name}</span>)}</div>}
              <KnowledgeDetails item={item} />
            </td>
            <td>
              <div>{KIND_LABEL[item.kind]}</div>
              {item.floralRole
                ? <div className="mt-1"><StatusBadge tone="info">{FLORAL_ROLE_LABEL[item.floralRole] ?? item.floralRole}</StatusBadge></div>
                : <div className="mt-1 text-xs text-zinc-400">角色未设置</div>}
            </td>
            <td>
              {item.colorTags.length > 0
                ? <div className="flex max-w-[10rem] flex-wrap gap-1">{item.colorTags.map((tag) => <span key={tag} className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">{tag}</span>)}</div>
                : <span className="text-zinc-400">—</span>}
            </td>
            <td>{[item.color, item.grade, item.gradeSpecification, item.specification].filter(Boolean).join(" · ") || "—"}</td>
            <td>{item.baseUnit} · {item.quantityScale === 0 ? "整数" : `${item.quantityScale} 位小数`}<div className="text-xs text-zinc-500">{item.reservePerOrder ? "逐单预留" : "不逐单预留"}</div></td>
            <td><StatusBadge tone={item.active ? "success" : "neutral"}>{item.active ? "启用" : "停用"}</StatusBadge></td>
            <td className="px-4 py-3">
              <V2DrawerForm
                triggerLabel="编辑"
                title="编辑物料"
                description={`${item.code} · ${item.name}`}
                action={updateMaterialAction}
                submitLabel="保存修改"
                size="xl"
                triggerClassName="cursor-pointer text-sm text-emerald-700 hover:underline"
                footerNote="编号由系统生成，编辑时不会修改。"
              >
                <input type="hidden" name="materialId" value={item.id} />
                <MaterialIdentityFields material={item} />
                <MaterialKnowledgeEditor material={toKnowledgeValue(item)} categories={categories} />
              </V2DrawerForm>
              <form action={setMaterialActiveAction} className="mt-2">
                <input type="hidden" name="materialId" value={item.id} />
                <input type="hidden" name="active" value={String(!item.active)} />
                <button className="text-xs text-zinc-600 underline">{item.active ? "停用" : "重新启用"}</button>
              </form>
              <form action={updateMaterialStandardCostAction} className="mt-2 flex items-center gap-1">
                <input type="hidden" name="materialId" value={item.id} />
                <input className="w-20 rounded border border-zinc-300 px-2 py-1 text-xs" name="standardUnitCost" type="number" min={0} step={0.0001} defaultValue={decimalText(item.standardUnitCost) ?? ""} placeholder="标准成本" aria-label="标准单位成本" />
                <button className="text-xs text-emerald-700 underline">改成本</button>
              </form>
              <form action={deleteMaterialAction} className="mt-1">
                <input type="hidden" name="materialId" value={item.id} />
                <button className="text-xs text-red-700 underline">删除</button>
              </form>
              {item.active && <p className="mt-1 max-w-[10rem] text-[11px] text-zinc-400">有业务引用时只能停用</p>}
            </td>
          </tr>)}
        </tbody>
      </table></div>}

    <p className="text-xs text-zinc-400">共 {materials.length} 条物料规格。丝带、胶带按“卷”管理；花泥按具体规格建物料并使用整数库存。编号、拼音索引与别名索引由系统维护。</p>
  </V2ModulePage>;
}
