import { V2Drawer, V2DrawerForm } from "../../_components/V2Drawer";
import { V2ImagePreview } from "../../_components/V2Image";
import {
  DetailItem,
  DetailList,
  StatusBadge,
  V2Table,
  dataTableBody,
  dataTableHead,
  numericCell,
  numericHead,
  stickyActionCell,
  stickyActionCellMuted,
  stickyActionHead,
} from "../../_components/V2Ui";
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
import { FLORAL_ROLE_LABEL, KIND_LABEL, decimalText, formatMoney, toKnowledgeValue } from "./material-format";
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

const ACTION_TRIGGER =
  "rounded-md px-1.5 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700";
const ROW_ACTION =
  "text-xs underline underline-offset-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700";

function display(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

function MaterialReadOnly({ item, scope }: { item: MaterialRow; scope: MaterialScopeConfig }) {
  const flower = scope.showFlowerFields;
  const categoryText = item.categories.length > 0
    ? item.categories.map((relation) => relation.category.name).join("、")
    : "—";

  return <div className="space-y-4">
    <div className="flex items-start gap-3">
      <V2ImagePreview stored={item.imageKey} alt={item.name} className="h-20 w-20" />
      <div className="min-w-0">
        <p className="text-base font-semibold text-stone-900">{item.name}</p>
        <p className="mt-0.5 font-mono text-xs text-stone-500">{item.code}</p>
        <div className="mt-2">
          <StatusBadge tone={item.active ? "success" : "neutral"}>{item.active ? "启用" : "停用"}</StatusBadge>
        </div>
      </div>
    </div>

    <DetailList>
      <DetailItem label="编号"><span className="font-mono text-xs">{item.code}</span></DetailItem>
      <DetailItem label="名称">{item.name}</DetailItem>
      <DetailItem label="类别">{KIND_LABEL[item.kind] ?? item.kind}</DetailItem>
      {flower
        ? <>
          <DetailItem label="角色">{item.floralRole ? FLORAL_ROLE_LABEL[item.floralRole] ?? item.floralRole : "—"}</DetailItem>
          <DetailItem label="种类">{display(item.flowerVariety)}</DetailItem>
          <DetailItem label="颜色">{display(item.color)}</DetailItem>
          <DetailItem label="商品名">{display(item.flowerProductName)}</DetailItem>
          <DetailItem label="等级">{display(item.grade)}</DetailItem>
          <DetailItem label="规格">{display(item.gradeSpecification || item.specification)}</DetailItem>
        </>
        : <>
          <DetailItem label="规格">{display(item.specification)}</DetailItem>
          <DetailItem label="品牌">{display(item.brand)}</DetailItem>
          <DetailItem label="型号">{display(item.model)}</DetailItem>
          <DetailItem label="安全库存">{`${decimalText(item.safetyStockThreshold) ?? "0"} ${item.baseUnit}`}</DetailItem>
        </>}
      <DetailItem label="库存单位">{item.baseUnit}</DetailItem>
      <DetailItem label="计量精度">{item.quantityScale === 0 ? "整数" : `${item.quantityScale} 位小数`}</DetailItem>
      <DetailItem label="预留规则">{item.reservePerOrder ? "逐单预留" : "不逐单预留"}</DetailItem>
      <DetailItem label="标准成本">{formatMoney(item)}</DetailItem>
      <DetailItem label="分类" span={2}>{categoryText}</DetailItem>
      <DetailItem label="拼音索引">{display(item.pinyinIndex)}</DetailItem>
      <DetailItem label="别名">{display(item.aliasText)}</DetailItem>
      <DetailItem label="英文名" span={2}>{display(item.englishName)}</DetailItem>
      <DetailItem label="备注" span={2}>{display(item.notes)}</DetailItem>
    </DetailList>

    {flower
      ? <section className="rounded-xl border border-stone-200 bg-white p-3">
        <h3 className="text-sm font-semibold text-stone-900">知识资料</h3>
        <div className="mt-2"><KnowledgeDetails item={item} scope={scope} /></div>
      </section>
      : null}

    <p className="text-xs text-stone-500">只读预览，不会修改数据。需要修改请关闭后点击「编辑」。</p>
  </div>;
}

/**
 * Shared material list table + create/edit drawers. The flower master shows
 * role/classification columns; the consumable master shows specification,
 * brand/model and safety stock instead. Both use the same server actions and
 * the same `Material` data model.
 *
 * This is the first real integration of the shared V2 table pattern: each
 * column renders one data field, numeric cells align right, and the rightmost
 * action header/cells opt in to sticky positioning inside the table's own
 * horizontal scroll container.
 */
export function MaterialTable({ scope, materials, categories, hasFilters, classification }: MaterialTableProps) {
  const flower = scope.showFlowerFields;

  if (materials.length === 0) {
    return <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-zinc-900">{hasFilters ? scope.filteredEmpty.title : scope.empty.title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-500">{hasFilters ? scope.filteredEmpty.description : scope.empty.description}</p>
    </div>;
  }

  return <V2Table label={`${scope.title}列表`} minWidthClass="min-w-[68rem]">
    <caption className="sr-only">{scope.title}列表</caption>
    <thead className={dataTableHead}><tr>
      <th scope="col" className="px-3 py-3">图片</th>
      <th scope="col" className="px-4 py-3">编号</th>
      <th scope="col" className="px-4 py-3">名称</th>
      <th scope="col" className="px-4 py-3">类别</th>
      {flower
        ? <>
          <th scope="col" className="px-4 py-3">角色</th>
          <th scope="col" className="px-4 py-3">种类</th>
          <th scope="col" className="px-4 py-3">颜色</th>
          <th scope="col" className="px-4 py-3">商品名</th>
        </>
        : <>
          <th scope="col" className="px-4 py-3">规格</th>
          <th scope="col" className="px-4 py-3">品牌</th>
          <th scope="col" className="px-4 py-3">型号</th>
        </>}
      <th scope="col" className="px-4 py-3">库存单位</th>
      {!flower && <th scope="col" className={numericHead}>安全库存</th>}
      <th scope="col" className={numericHead}>标准成本</th>
      <th scope="col" className="px-4 py-3">状态</th>
      <th scope="col" className={stickyActionHead}>操作</th>
    </tr></thead>
    <tbody className={dataTableBody}>
      {materials.map((item) => {
        const inactive = !item.active;
        return <tr key={item.id} className={`group align-top ${inactive ? "bg-stone-50 text-stone-500" : "hover:bg-stone-50/70"}`}>
          <td className="px-3 py-3"><V2ImagePreview stored={item.imageKey} alt={item.name} compact className="h-14 w-14" /></td>
          <td className="px-4 py-3"><span className="font-mono text-xs text-stone-600">{item.code}</span></td>
          <td className="px-4 py-3"><span className="font-medium text-stone-900">{item.name}</span></td>
          <td className="px-4 py-3">{KIND_LABEL[item.kind] ?? item.kind}</td>
          {flower
            ? <>
              <td className="px-4 py-3">
                {item.floralRole
                  ? <StatusBadge tone="info">{FLORAL_ROLE_LABEL[item.floralRole] ?? item.floralRole}</StatusBadge>
                  : <span className="text-xs text-stone-400">未设置</span>}
              </td>
              <td className="px-4 py-3">{display(item.flowerVariety)}</td>
              <td className="px-4 py-3">{display(item.color)}</td>
              <td className="px-4 py-3">{display(item.flowerProductName)}</td>
            </>
            : <>
              <td className="px-4 py-3">{display(item.specification)}</td>
              <td className="px-4 py-3">{display(item.brand)}</td>
              <td className="px-4 py-3">{display(item.model)}</td>
            </>}
          <td className="px-4 py-3">{item.baseUnit}</td>
          {!flower && <td className={numericCell}>{decimalText(item.safetyStockThreshold) ?? "0"}</td>}
          <td className={numericCell}>{formatMoney(item)}</td>
          <td className="px-4 py-3"><StatusBadge tone={item.active ? "success" : "neutral"}>{item.active ? "启用" : "停用"}</StatusBadge></td>
          <td className={`${inactive ? stickyActionCellMuted : stickyActionCell} ${inactive ? "" : "group-hover:bg-stone-50"}`}>
            <div className="flex items-center gap-1">
              <V2Drawer
                triggerLabel="查看"
                triggerAriaLabel={`查看 ${item.name}`}
                title={`${scope.editDescriptionPrefix}详情`}
                description={`${item.code} · ${item.name}`}
                size="lg"
                triggerClassName={ACTION_TRIGGER}
                footerNote="只读预览，不会修改数据。"
              >
                <MaterialReadOnly item={item} scope={scope} />
              </V2Drawer>
              <span aria-hidden className="text-stone-300">|</span>
              <V2DrawerForm
                triggerLabel="编辑"
                triggerAriaLabel={`编辑 ${item.name}`}
                title={scope.editTitle}
                description={`${item.code} · ${item.name}`}
                action={updateMaterialAction}
                submitLabel="保存修改"
                size="xl"
                triggerClassName={ACTION_TRIGGER}
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
            </div>

            <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-stone-100 pt-2">
              <form action={setMaterialActiveAction}>
                <input type="hidden" name="materialId" value={item.id} />
                <input type="hidden" name="returnTo" value={scope.basePath} />
                <input type="hidden" name="active" value={String(!item.active)} />
                <button className={`${ROW_ACTION} text-stone-600 hover:text-stone-900`}>{item.active ? "停用" : "重新启用"}</button>
              </form>
              <form action={updateMaterialStandardCostAction} className="flex items-center gap-1">
                <input type="hidden" name="materialId" value={item.id} />
                <input type="hidden" name="returnTo" value={scope.basePath} />
                <input
                  className="w-16 rounded border border-stone-300 px-1.5 py-1 text-xs tabular-nums text-stone-900"
                  name="standardUnitCost"
                  type="number"
                  min={0}
                  step={0.0001}
                  defaultValue={decimalText(item.standardUnitCost) ?? ""}
                  placeholder="成本"
                  aria-label={`${item.name} 标准单位成本`}
                />
                <button className={`${ROW_ACTION} text-emerald-800 hover:text-emerald-900`}>改成本</button>
              </form>
              <form action={deleteMaterialAction}>
                <input type="hidden" name="materialId" value={item.id} />
                <input type="hidden" name="returnTo" value={scope.basePath} />
                <button className={`${ROW_ACTION} text-red-700 hover:text-red-900`} aria-label={`删除 ${item.name}`}>删除</button>
              </form>
            </div>
            {item.active && <p className="mt-1 max-w-[12rem] text-[11px] leading-4 text-stone-400">有业务引用时只能停用</p>}
          </td>
        </tr>;
      })}
    </tbody>
  </V2Table>;
}
