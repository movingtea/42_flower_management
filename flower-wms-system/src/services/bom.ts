import type { BomMaterialLine } from "@/types";

/**
 * 花束 SKU → 花材 BOM（示例数据，后续可迁入数据库 BOM 表）。
 * quantityPerUnit：每售出 1 件成品所需花材数量。
 */
const BOM_BY_SKU: Record<
  string,
  { productId: string; sku: string; name: string; quantityPerUnit: number; unit: string }[]
> = {
  "BOUQUET-ROSE-11": [
    {
      productId: "mock-rose-red",
      sku: "RAW-ROSE-RED",
      name: "红玫瑰",
      quantityPerUnit: 11,
      unit: "支",
    },
    {
      productId: "mock-eucalyptus",
      sku: "RAW-EUCALYPTUS",
      name: "尤加利叶",
      quantityPerUnit: 3,
      unit: "支",
    },
  ],
  "BOUQUET-SUN-3": [
    {
      productId: "mock-sunflower",
      sku: "RAW-SUNFLOWER",
      name: "向日葵",
      quantityPerUnit: 3,
      unit: "支",
    },
  ],
};

/**
 * 将小程序售出的「花束」拆解为仓库花材/包材需求。
 */
export function expandBom(
  productSku: string,
  orderQuantity: number
): BomMaterialLine[] {
  const lines = BOM_BY_SKU[productSku];
  if (!lines) {
    throw new Error(`未配置 BOM：${productSku}`);
  }

  return lines.map((line) => ({
    productId: line.productId,
    sku: line.sku,
    name: line.name,
    unit: line.unit,
    quantity: line.quantityPerUnit * orderQuantity,
  }));
}

export function hasBom(productSku: string): boolean {
  return productSku in BOM_BY_SKU;
}
