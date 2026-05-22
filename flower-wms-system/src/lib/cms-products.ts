import type { CmsProductCategoryItem } from "@/lib/cms-product-categories";
import {
  cmsCategoryValueSet,
  parseProductCategoryPayload,
} from "@/lib/cms-product-categories";

export type CmsProductBody = {
  /** 仅编辑回显用；创建时由服务端自动生成，可不传 */
  sku?: string;
  name: string;
  category: string[];
  sellPrice?: number | null;
  costPrice?: number | null;
  quantity: number;
  isActive: boolean;
  isOutOfStock?: boolean;
  allowPreOrder?: boolean;
  productionTime?: number;
  description?: string | null;
  careTips?: string | null;
  imageUrl?: string | null;
};

export function parseCmsProductBody(
  raw: unknown,
  categoryConfig: CmsProductCategoryItem[]
): CmsProductBody {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }

  const b = raw as Record<string, unknown>;
  const sku =
    typeof b.sku === "string" && b.sku.trim() ? b.sku.trim() : undefined;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new Error("name 不能为空");

  const allowed = cmsCategoryValueSet(categoryConfig);
  const category = parseProductCategoryPayload(b.category, allowed);

  let sellPrice: number | null = null;
  if (b.sellPrice != null && b.sellPrice !== "") {
    sellPrice = Number(b.sellPrice);
    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      throw new Error("sellPrice 无效");
    }
  }

  const quantity = Number(b.quantity ?? 0);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error("quantity 须为非负整数");
  }

  let costPrice: number | null = null;
  if (b.costPrice != null && b.costPrice !== "") {
    costPrice = Number(b.costPrice);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      throw new Error("costPrice 无效");
    }
  }

  const productionTime = Number(b.productionTime ?? 30);
  if (!Number.isInteger(productionTime) || productionTime < 0) {
    throw new Error("productionTime 须为非负整数");
  }

  return {
    sku,
    name,
    category,
    sellPrice,
    costPrice,
    quantity,
    isActive: Boolean(b.isActive),
    isOutOfStock: Boolean(b.isOutOfStock),
    allowPreOrder: b.allowPreOrder !== false,
    productionTime,
    description:
      typeof b.description === "string" ? b.description.trim() || null : null,
    careTips: typeof b.careTips === "string" ? b.careTips.trim() || null : null,
    imageUrl: typeof b.imageUrl === "string" ? b.imageUrl.trim() || null : null,
  };
}
