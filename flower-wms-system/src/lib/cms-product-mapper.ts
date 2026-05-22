import type { Prisma } from "@/generated/prisma/client";
import type { CmsProductBody } from "@/lib/cms-products";
import {
  PRODUCT_STATUS_PUBLISHED,
  productStatusFromIsActive,
} from "@/lib/product-status";
import type { ProductWithCategories } from "@/lib/product-categories";
import type { ProductEditorInitial } from "@/app/cms/products/types";

/** CMS 请求体 → Prisma Product 写入字段 */
export function cmsBodyToProductData(
  body: CmsProductBody
): Omit<Prisma.ProductUncheckedCreateInput, "sku"> {
  const images: string[] = [];
  if (body.imageUrl?.trim()) {
    images.push(body.imageUrl.trim());
  }

  return {
    name: body.name,
    price: body.sellPrice ?? 0,
    costPrice: body.costPrice ?? null,
    subtitle: body.description?.trim()
      ? body.description.trim().slice(0, 500)
      : null,
    images,
    detailContent: [body.description, body.careTips]
      .filter((s): s is string => Boolean(s?.trim()))
      .join("\n\n")
      .trim() || null,
    status: productStatusFromIsActive(body.isActive),
    quantity: body.quantity,
    isOutOfStock: body.isOutOfStock ?? false,
    allowPreOrder: body.allowPreOrder ?? true,
    productionTime: body.productionTime ?? 30,
  };
}

/** 数据库 Product → CMS 编辑器初始值 */
export function productToEditorInitial(
  product: ProductWithCategories,
  categoryKeys: string[]
): ProductEditorInitial {
  const detail = product.detailContent ?? "";
  const subtitle = product.subtitle ?? "";
  const description =
    detail && subtitle && detail.startsWith(subtitle)
      ? detail
      : [subtitle, detail].filter(Boolean).join("\n\n");

  return {
    sku: product.sku,
    name: product.name,
    category: categoryKeys,
    sellPrice: product.price.toString(),
    quantity: product.quantity,
    isActive: product.status === PRODUCT_STATUS_PUBLISHED,
    description,
    careTips: "",
    imageUrl: product.images[0] ?? "",
  };
}
