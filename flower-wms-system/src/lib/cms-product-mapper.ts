import type { Prisma } from "@/generated/prisma/client";
import type { CmsProductBody } from "@/lib/cms-products";
import {
  PRODUCT_STATUS_PUBLISHED,
  productStatusFromIsActive,
} from "@/lib/product-status";
import {
  filterEditorDisplayCategoryIds,
  type ProductWithCategories,
} from "@/lib/product-categories";
import type { ProductCategoryFlatRow } from "@/lib/product-category";
import type { ProductEditorInitial } from "@/app/cms/products/types";
import {
  htmlToPlainExcerpt,
  mergeProductDetailHtml,
  splitProductDetailHtml,
} from "@/lib/product-detail-content";

/** CMS 请求体 → Prisma Product 写入字段 */
export function cmsBodyToProductData(
  body: CmsProductBody
): Omit<Prisma.ProductUncheckedCreateInput, "sku"> {
  const images: string[] = [];
  if (body.imageUrl?.trim()) {
    images.push(body.imageUrl.trim());
  }

  const descriptionHtml = body.description?.trim() ?? "";
  const careHtml = body.careTips?.trim() ?? "";
  const detailContent = mergeProductDetailHtml(descriptionHtml, careHtml);
  const subtitle = descriptionHtml
    ? htmlToPlainExcerpt(descriptionHtml)
    : null;

  return {
    name: body.name,
    price: body.sellPrice ?? 0,
    costPrice: body.costPrice ?? null,
    subtitle,
    images,
    detailContent,
    status: productStatusFromIsActive(body.isActive),
    quantity: body.quantity,
    isOutOfStock: body.isOutOfStock ?? false,
    allowPreOrder: body.allowPreOrder ?? true,
    productionTime: body.productionTime ?? 30,
    shippingFee: body.shippingFee,
  };
}

/** 数据库 Product → CMS 编辑器初始值 */
export function productToEditorInitial(
  product: ProductWithCategories,
  categoryIds: string[],
  categoryFlatRows?: ProductCategoryFlatRow[]
): ProductEditorInitial {
  const { description, maintenanceGuideline } = splitProductDetailHtml(
    product.detailContent
  );

  const fee = Number(product.shippingFee ?? 0);

  const categoryForEditor = categoryFlatRows
    ? filterEditorDisplayCategoryIds(categoryIds, categoryFlatRows)
    : categoryIds;

  return {
    sku: product.sku,
    name: product.name,
    category: categoryForEditor,
    sellPrice: product.price.toString(),
    quantity: product.quantity,
    isActive: product.status === PRODUCT_STATUS_PUBLISHED,
    needsShipping: fee > 0,
    shippingFee: fee > 0 ? fee.toFixed(2) : "",
    description,
    careTips: maintenanceGuideline,
    imageUrl: product.images[0] ?? "",
  };
}
