"use client";

import { useId, useState } from "react";
import { input } from "../../_components/V2Ui";

/** A 种类 + 颜色 + 商品名 combination already used by a flower material. */
export type FlowerProductOption = {
  variety: string | null;
  color: string | null;
  name: string;
};

/** A colour already used under a 种类 (三级分类第二级). */
export type FlowerColorOption = {
  variety: string | null;
  color: string;
};

export type FlowerClassificationValue = {
  flowerVariety: string | null;
  flowerProductName: string | null;
  color: string | null;
};

/**
 * Flower three-level classification inputs in display order
 * 种类 (Material.flowerVariety) -> 颜色 (Material.color) ->
 * 商品名 (Material.flowerProductName).
 *
 * Suggestions come from existing material rows so operators can reuse an
 * already classified flower instead of retyping it. Choosing a 种类 narrows the
 * 颜色 suggestions, and choosing a 颜色 narrows the 商品名 suggestions. Inputs
 * stay free text because a new 种类/颜色/商品名 is allowed.
 */
export function FlowerClassificationFields({
  material,
  varieties,
  colors,
  products,
}: {
  material?: FlowerClassificationValue;
  varieties: string[];
  colors: FlowerColorOption[];
  products: FlowerProductOption[];
}) {
  const id = useId();
  const varietyListId = `${id}-varieties`;
  const colorListId = `${id}-colors`;
  const productListId = `${id}-products`;
  const [variety, setVariety] = useState(material?.flowerVariety ?? "");
  const [color, setColor] = useState(material?.color ?? "");

  const colorCandidates = [...new Set(
    colors
      .filter((option) => (variety ? option.variety === variety : true))
      .map((option) => option.color.trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, "zh"));

  const productNames = [...new Set(
    products
      .filter((product) => (variety ? product.variety === variety : true))
      .filter((product) => (color ? product.color === color : true))
      .map((product) => product.name.trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, "zh"));

  return <>
    <label className="block text-sm text-stone-700">
      种类
      <input
        className={`${input} mt-1`}
        name="flowerVariety"
        defaultValue={material?.flowerVariety ?? ""}
        list={varietyListId}
        maxLength={30}
        placeholder="如：玫瑰"
        onChange={(event) => setVariety(event.target.value.trim())}
      />
      <datalist id={varietyListId}>
        {varieties.map((value) => <option key={value} value={value} />)}
      </datalist>
    </label>
    <label className="block text-sm text-stone-700">
      颜色
      <input
        className={`${input} mt-1`}
        name="color"
        defaultValue={material?.color ?? ""}
        list={colorListId}
        maxLength={40}
        placeholder={variety ? `如：${variety}的常见颜色` : "如：粉色"}
        onChange={(event) => setColor(event.target.value.trim())}
      />
      <datalist id={colorListId}>
        {colorCandidates.map((value) => <option key={value} value={value} />)}
      </datalist>
    </label>
    <label className="block text-sm text-stone-700">
      商品名
      <input
        className={`${input} mt-1`}
        name="flowerProductName"
        defaultValue={material?.flowerProductName ?? ""}
        list={productListId}
        maxLength={40}
        placeholder={variety && color ? `如：${variety}${color}的商品名` : "选填，如：玛格丽特"}
      />
      <datalist id={productListId}>
        {productNames.map((value) => <option key={value} value={value} />)}
      </datalist>
    </label>
    <p className="text-xs text-zinc-500 md:col-span-2">
      三级分类按「种类 → 颜色 → 商品名」维护，列表与筛选都使用这三个字段；物料名称留空时会按「种类 · 颜色 · 商品名」自动生成。下面的「颜色标签」是可选的多色标记，不参与三级分类筛选。
    </p>
  </>;
}
