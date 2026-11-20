import { V2DrawerForm } from "../../_components/V2Drawer";
import { V2ImagePreview } from "../../_components/V2Image";
import { StatusBadge, tableHead, tableShell } from "../../_components/V2Ui";
import {
  deleteMaterialAction,
  setMaterialActiveAction,
  updateMaterialAction,
  updateMaterialStandardCostAction,
} from "../actions";
import { MaterialKnowledgeEditor } from "../MaterialKnowledgeEditor";
import { FlowerClassificationFields, type FlowerColorOption, type FlowerProductOption } from "./FlowerClassificationFields";
import { KnowledgeDetails } from "./KnowledgeDetails";
import { MaterialIdentityFields } from "./MaterialIdentityFields";
import { FLORAL_ROLE_LABEL, KIND_LABEL, decimalText, toKnowledgeValue } from "./material-format";
import type { MaterialScopeConfig } from "./material-scope";
import type { MaterialCategoryOption, MaterialRow } from "./material-types";

export type FlowerClassificationOptions = {
  varieties: string[];
  /** Existing 种类 + 颜色 pairs, used to cascade the 颜色 suggestions. */
  colors: FlowerColorOption[];
  /** Existing 种类 + 颜色 + 商品名 combinations, used to cascade 商品名. */
  products: FlowerProductOption[];
};

type MaterialTableProps = {
  scope: MaterialScopeConfig;
  materials: MaterialRow[];
  categories: MaterialCategoryOption[];
  hasFilters: boolean;
  /** Flower three-level classification suggestions (empty for the consumable page). */
  classification: FlowerClassificationOptions;
};

/**
 * Shared material list table + create/edit drawers. The flower master shows
 * role/colour/knowledge columns; the consumable master shows specification,
 * brand/model and safety stock instead. Both use the same server actions and
 * the same `Material` data model.
 */
export function MaterialTable({ scope, materials, categories, hasFilters, classification }: MaterialTableProps) {
  const flower = scope.showFlowerFields;

  if (materials.length === 0) {
    return <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-zinc-900">{hasFilters ? scope.filteredEmpty.title : scope.empty.title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-500">{hasFilters ? scope.filteredEmpty.description : scope.empty.description}</p>
    </div>;
  }

  return <div className={tableShell}><table className="w-full text-left text-sm">
    <thead className={tableHead}><tr>
      <th className="px-3 py-3">图片</th>
      <th className="px-4 py-3">编号</th>
      <th className="px-4 py-3">名称</th>
      {flower
        ? <>
          <th>类别 / 角色</th>
          <th>花材分类（种类 · 颜色 · 商品名）</th>
          <th>品质与规格</th>
        </>
        : <>
          <th>类别</th>
          <th>规格</th>
          <th>品牌 / 型号</th>
        </>}
      <th>库存单位</th>
      {!flower && <th>安全库存</th>}
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
          <KnowledgeDetails item={item} scope={scope} />
        </td>
        {flower
          ? <>
            <td>
              <div>{KIND_LABEL[item.kind]}</div>
              {item.floralRole
                ? <div className="mt-1"><StatusBadge tone="info">{FLORAL_ROLE_LABEL[item.floralRole] ?? item.floralRole}</StatusBadge></div>
                : <div className="mt-1 text-xs text-zinc-400">角色未设置</div>}
            </td>
            <td>
              <div className="font-medium text-zinc-900">
                {[item.flowerVariety, item.color, item.flowerProductName].filter(Boolean).join(" · ") || "—"}
              </div>
              {item.colorTags.length > 0 && <div className="mt-1 flex max-w-[10rem] flex-wrap gap-1">{item.colorTags.map((tag) => <span key={tag} className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">{tag}</span>)}</div>}
            </td>
            <td>{[item.grade, item.gradeSpecification, item.specification].filter(Boolean).join(" · ") || "—"}</td>
          </>
          : <>
            <td>{KIND_LABEL[item.kind]}</td>
            <td>{item.specification || "—"}</td>
            <td>{[item.brand, item.model].filter(Boolean).join(" / ") || "—"}</td>
          </>}
        <td>{item.baseUnit} · {item.quantityScale === 0 ? "整数" : `${item.quantityScale} 位小数`}<div className="text-xs text-zinc-500">{item.reservePerOrder ? "逐单预留" : "不逐单预留"}</div></td>
        {!flower && <td>{decimalText(item.safetyStockThreshold) ?? "0"} {item.baseUnit}</td>}
        <td><StatusBadge tone={item.active ? "success" : "neutral"}>{item.active ? "启用" : "停用"}</StatusBadge></td>
        <td className="px-4 py-3">
          <V2DrawerForm
            triggerLabel="编辑"
            title={scope.editTitle}
            description={`${item.code} · ${item.name}`}
            action={updateMaterialAction}
            submitLabel="保存修改"
            size="xl"
            triggerClassName="cursor-pointer text-sm text-emerald-700 hover:underline"
            footerNote="编号由系统生成，编辑时不会修改。"
          >
            <input type="hidden" name="materialId" value={item.id} />
            <input type="hidden" name="returnTo" value={scope.basePath} />
            <MaterialIdentityFields
              material={item}
              scope={scope}
              classificationFields={flower
                ? <FlowerClassificationFields material={item} {...classification} />
                : undefined}
            />
            <MaterialKnowledgeEditor
              material={toKnowledgeValue(item)}
              categories={categories}
              variant={flower ? "flower" : "consumable"}
            />
          </V2DrawerForm>
          <form action={setMaterialActiveAction} className="mt-2">
            <input type="hidden" name="materialId" value={item.id} />
            <input type="hidden" name="returnTo" value={scope.basePath} />
            <input type="hidden" name="active" value={String(!item.active)} />
            <button className="text-xs text-zinc-600 underline">{item.active ? "停用" : "重新启用"}</button>
          </form>
          <form action={updateMaterialStandardCostAction} className="mt-2 flex items-center gap-1">
            <input type="hidden" name="materialId" value={item.id} />
            <input type="hidden" name="returnTo" value={scope.basePath} />
            <input className="w-20 rounded border border-zinc-300 px-2 py-1 text-xs" name="standardUnitCost" type="number" min={0} step={0.0001} defaultValue={decimalText(item.standardUnitCost) ?? ""} placeholder="标准成本" aria-label="标准单位成本" />
            <button className="text-xs text-emerald-700 underline">改成本</button>
          </form>
          <form action={deleteMaterialAction} className="mt-1">
            <input type="hidden" name="materialId" value={item.id} />
            <input type="hidden" name="returnTo" value={scope.basePath} />
            <button className="text-xs text-red-700 underline">删除</button>
          </form>
          {item.active && <p className="mt-1 max-w-[10rem] text-[11px] text-zinc-400">有业务引用时只能停用</p>}
        </td>
      </tr>)}
    </tbody>
  </table></div>;
}
