"use client";

import {
  CMS_BUDGET_TAG_OPTIONS,
  CMS_COLOR_TAG_OPTIONS,
  CMS_OCCASION_TAG_OPTIONS,
  CMS_POSITIONING_TAG_OPTIONS,
  CMS_RELATIONSHIP_TAG_OPTIONS,
  CMS_STYLE_TAG_OPTIONS,
} from "@/lib/cms-product-tags";
import { ProductTagPillsEditor } from "@/components/cms/ProductTagPillsEditor";
import { Input } from "@/components/ui/input";

export type ProductOperationTagsValue = {
  occasionTags: string[];
  colorTags: string[];
  styleTags: string[];
  relationshipTags: string[];
  budgetTags: string[];
  positioningTags: string[];
  sellingPoints: string[];
  operationNote: string;
};

type Props = {
  value: ProductOperationTagsValue;
  onChange: (next: ProductOperationTagsValue) => void;
};

export function ProductOperationTagsEditor({ value, onChange }: Props) {
  function patch(partial: Partial<ProductOperationTagsValue>) {
    onChange({ ...value, ...partial });
  }

  function addSellingPoint(text: string) {
    const trimmed = text.trim();
    if (!trimmed || value.sellingPoints.includes(trimmed)) return;
    patch({ sellingPoints: [...value.sellingPoints, trimmed].slice(0, 20) });
  }

  function removeSellingPoint(index: number) {
    patch({
      sellingPoints: value.sellingPoints.filter((_, i) => i !== index),
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">
        运营标签用于小程序展示、场景推荐与上架校验参考，不会自动改变商品上下架或价格。
      </p>

      <ProductTagPillsEditor
        label="适用场景"
        options={CMS_OCCASION_TAG_OPTIONS}
        value={value.occasionTags}
        onChange={(occasionTags) => patch({ occasionTags })}
      />

      <ProductTagPillsEditor
        label="色系标签"
        options={CMS_COLOR_TAG_OPTIONS}
        value={value.colorTags}
        onChange={(colorTags) => patch({ colorTags })}
      />

      <ProductTagPillsEditor
        label="风格标签"
        options={CMS_STYLE_TAG_OPTIONS}
        value={value.styleTags}
        onChange={(styleTags) => patch({ styleTags })}
      />

      <ProductTagPillsEditor
        label="适合关系"
        options={CMS_RELATIONSHIP_TAG_OPTIONS}
        value={value.relationshipTags}
        onChange={(relationshipTags) => patch({ relationshipTags })}
      />

      <ProductTagPillsEditor
        label="预算区间"
        hint="建议单选，便于前台筛选"
        options={CMS_BUDGET_TAG_OPTIONS}
        value={value.budgetTags}
        onChange={(budgetTags) => patch({ budgetTags })}
        singleSelect
      />

      <ProductTagPillsEditor
        label="商品定位"
        options={CMS_POSITIONING_TAG_OPTIONS}
        value={value.positioningTags}
        onChange={(positioningTags) => patch({ positioningTags })}
      />

      <div className="space-y-2">
        <p className="text-sm font-medium text-zinc-800">卖点短语</p>
        <p className="text-xs text-zinc-500">
          输入短句后按回车添加，如「适合生日礼赠」「粉色温柔系」
        </p>
        <div className="flex flex-wrap gap-2">
          {value.sellingPoints.map((point, index) => (
            <span
              key={`${point}-${index}`}
              className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-sm text-rose-800"
            >
              {point}
              <button
                type="button"
                onClick={() => removeSellingPoint(index)}
                className="text-rose-500 hover:text-rose-700"
                aria-label="移除卖点"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          placeholder="输入卖点后回车"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addSellingPoint((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).value = "";
            }
          }}
        />
      </div>

      <div>
        <Input
          label="运营备注（仅后台可见）"
          value={value.operationNote}
          onChange={(e) => patch({ operationNote: e.target.value })}
          placeholder="内部运营备注，不会展示给小程序用户"
        />
        <p className="mt-1 text-xs text-zinc-500">
          运营备注仅后台可见，不会展示给小程序用户。
        </p>
      </div>
    </div>
  );
}
