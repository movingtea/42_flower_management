"use client";

import { useState } from "react";
import { input } from "../../_components/V2Ui";
import type { FlowerColorOption, FlowerProductOption } from "./FlowerClassificationFields";

/**
 * Cascading flower-classification filter for the flower list.
 *
 * Order follows the 三级分类 display order 种类 -> 颜色 -> 商品名: selecting a
 * 种类 narrows the 颜色 options, and 种类 + 颜色 narrow the 商品名 options.
 * All options come from the server-rendered page data, so changing a select does
 * not issue an extra request.
 */
export function FlowerClassificationFilter({
  varieties,
  colors,
  products,
  defaultVariety,
  defaultColor,
  defaultProductName,
}: {
  varieties: string[];
  colors: FlowerColorOption[];
  products: FlowerProductOption[];
  defaultVariety: string;
  defaultColor: string;
  defaultProductName: string;
}) {
  const [variety, setVariety] = useState(defaultVariety);
  const [color, setColor] = useState(defaultColor);
  const [productName, setProductName] = useState(defaultProductName);

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
    <select
      className={`${input} w-36`}
      name="variety"
      value={variety}
      onChange={(event) => {
        setVariety(event.target.value);
        // A colour/product from another 种类 would not match the narrowed lists.
        setColor("");
        setProductName("");
      }}
      aria-label="种类筛选"
    >
      <option value="">全部种类</option>
      {varieties.map((value) => <option key={value} value={value}>{value}</option>)}
    </select>
    <select
      className={`${input} w-36`}
      name="color"
      value={color}
      onChange={(event) => {
        setColor(event.target.value);
        setProductName("");
      }}
      aria-label="颜色筛选"
    >
      <option value="">全部颜色</option>
      {colorCandidates.map((value) => <option key={value} value={value}>{value}</option>)}
    </select>
    <select
      className={`${input} w-36`}
      name="productName"
      value={productName}
      onChange={(event) => setProductName(event.target.value)}
      aria-label="商品名筛选"
    >
      <option value="">全部商品名</option>
      {productNames.map((value) => <option key={value} value={value}>{value}</option>)}
    </select>
  </>;
}
