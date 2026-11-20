import type { ReactNode } from "react";
import { FloralRole, LossMode } from "@/generated/prisma-v2/client";
import { formatDateTime } from "@/lib/format-display";
import { Field, input } from "../../_components/V2Ui";
import { FLORAL_ROLE_LABEL, KIND_LABEL, LOSS_MODE_LABEL, aliasListText, ratePercentText } from "./material-format";
import type { MaterialScopeConfig } from "./material-scope";
import type { MaterialRow } from "./material-types";

/**
 * Identity fields shared by the flower and consumable create/edit drawers.
 * `编号` is system generated; the edit drawer additionally shows the read-only
 * identifier, timestamps and the stored pinyin index. Scope-specific fields are
 * hidden here instead of being duplicated in two page files.
 */
export function MaterialIdentityFields({
  material,
  scope,
  classificationFields,
}: {
  material?: MaterialRow;
  scope: MaterialScopeConfig;
  /** Flower three-level classification inputs (种类 / 颜色 / 商品名), rendered after the name. */
  classificationFields?: ReactNode;
}) {
  return <div className="grid gap-3 md:grid-cols-2">
    {material && <div className="md:col-span-2 rounded-lg bg-zinc-50 px-3 py-2">
      <div className="text-xs text-zinc-500">{scope.editDescriptionPrefix}编号</div>
      <div className="font-mono text-sm text-zinc-900">{material.code}</div>
      <div className="mt-1 text-xs text-zinc-400">系统自动生成，不可修改；拼音索引 {material.pinyinIndex || "—"}（{material.aliasText ? `别名 ${material.aliasText}` : "无别名"}）</div>
    </div>}
    <Field
      label={scope.showFlowerFields ? "物料名称（选填，留空按种类 · 颜色 · 商品名自动生成）" : "物料名称"}
      name="name"
      required={!scope.showFlowerFields}
      defaultValue={material?.name}
    />
    <label className="block text-sm text-stone-700">物料类别<select className={`${input} mt-1`} name="kind" defaultValue={material?.kind ?? scope.kinds[0]}>{scope.kinds.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind] ?? kind}</option>)}</select></label>
    {classificationFields ?? (!scope.showFlowerFields && <Field label="颜色" name="color" required={false} defaultValue={material?.color ?? ""} />)}
    {scope.showFlowerFields && <>
      <label className="block text-sm text-stone-700">花材角色<select className={`${input} mt-1`} name="floralRole" defaultValue={material?.floralRole ?? ""}><option value="">未设置</option>{Object.values(FloralRole).map((role) => <option key={role} value={role}>{FLORAL_ROLE_LABEL[role] ?? role}</option>)}</select></label>
      <Field label="颜色标签（可选，多色标记，逗号分隔，最多 20 个）" name="colorTags" required={false} defaultValue={material?.colorTags.join("，") ?? ""} />
      <Field label="品质等级" name="grade" required={false} defaultValue={material?.grade ?? ""} />
      <Field label="等级说明（如长度范围）" name="gradeSpecification" required={false} defaultValue={material?.gradeSpecification ?? ""} />
    </>}
    <Field label="规格" name="specification" required={false} defaultValue={material?.specification ?? ""} />
    <Field label="库存单位" name="baseUnit" defaultValue={material?.baseUnit ?? (scope.showFlowerFields ? "支" : "个")} />
    <Field label="库存小数位数" name="quantityScale" type="number" defaultValue={material?.quantityScale ?? 0} />
    <label className="block text-sm text-stone-700">别名（中文别名，逗号分隔，最多 20 个）<input className={`${input} mt-1`} name="aliases" maxLength={800} defaultValue={aliasListText(material?.aliasMap)} placeholder="如：玫瑰，月季，刺玫" /></label>
    {scope.showFlowerFields && <>
      <label className="block text-sm text-stone-700 md:col-span-2">形态特征<textarea className={`${input} mt-1 min-h-16`} name="morphology" maxLength={200} defaultValue={material?.morphology ?? ""} placeholder="如：花头饱满、花瓣层叠、茎粗直，最多 200 字" /></label>
      <label className="block text-sm text-stone-700">默认可用率（%）<input className={`${input} mt-1`} name="defaultUsableRate" type="number" min={0} max={100} step={0.01} defaultValue={ratePercentText(material?.defaultUsableRate)} placeholder="如 85" /></label>
      <label className="block text-sm text-stone-700">默认损耗率（%）<input className={`${input} mt-1`} name="defaultLossRate" type="number" min={0} max={100} step={0.01} defaultValue={ratePercentText(material?.defaultLossRate)} placeholder="如 15" /></label>
      <label className="block text-sm text-stone-700">损耗模式<select className={`${input} mt-1`} name="lossMode" defaultValue={material?.lossMode ?? "STANDARD"}>{Object.values(LossMode).map((mode) => <option key={mode} value={mode}>{LOSS_MODE_LABEL[mode] ?? mode}</option>)}</select></label>
    </>}
    <label className="flex items-center gap-2 text-sm text-stone-700 md:col-span-2"><input type="checkbox" name="reservePerOrder" defaultChecked={material?.reservePerOrder ?? true} /> 按订单预留库存</label>
    {material && <div className="md:col-span-2 space-y-0.5 text-xs text-zinc-500">
      <div>标准成本更新时间：{formatDateTime(material.costUpdatedAt)}</div>
      <div>损耗率更新时间：{formatDateTime(material.lossRateUpdatedAt)}</div>
    </div>}
  </div>;
}
