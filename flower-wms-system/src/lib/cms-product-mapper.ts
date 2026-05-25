import type { Prisma } from "@/generated/prisma/client";
import type { CmsProductBody } from "@/lib/cms-products";
import type { ProductEditorInitial } from "@/app/cms/products/types";
import type { ProductCategoryFlatRow } from "@/lib/product-category";
import {
  filterEditorDisplayCategoryIds,
  type ProductWithCategories,
} from "@/lib/product-categories";
import {
  resolveSpuCardImageUrl,
  resolveSpuMinPrice,
} from "@/lib/product-spu";

export function cmsBodyToSpuData(
  body: CmsProductBody
): Omit<Prisma.ProductSpuUncheckedCreateInput, "id"> {
  return {
    name: body.name,
    description: body.description,
    maintenanceGuide: body.maintenanceGuide,
    isActive: body.isActive,
    isDeleted: false,
    shippingFee: body.shippingFee,
    allowPreOrder: body.allowPreOrder ?? true,
    productionTime: body.productionTime ?? 30,
    recipeId: body.recipeId ?? null,
  };
}

export function productToEditorInitial(
  spu: ProductWithCategories,
  categoryIds: string[],
  categoryFlatRows?: ProductCategoryFlatRow[]
): ProductEditorInitial {
  const categoryForEditor = categoryFlatRows
    ? filterEditorDisplayCategoryIds(categoryIds, categoryFlatRows)
    : categoryIds;

  const skus = spu.skus.map((sku) => ({
    id: sku.id,
    skuCode: sku.skuCode,
    specName: sku.specName,
    price: sku.price.toString(),
    stock: sku.stock,
    imageUrl: sku.imageUrl ?? "",
    isMainImage: sku.isMainImage,
    sortOrder: sku.sortOrder,
  }));

  const cardImage = resolveSpuCardImageUrl(spu.skus);
  const minPrice = resolveSpuMinPrice(spu.skus);

  return {
    name: spu.name,
    category: categoryForEditor,
    description: spu.description ?? "",
    maintenanceGuide: spu.maintenanceGuide ?? "",
    isActive: spu.isActive,
    needsShipping: Number(spu.shippingFee ?? 0) > 0,
    shippingFee:
      Number(spu.shippingFee ?? 0) > 0
        ? Number(spu.shippingFee).toFixed(2)
        : "",
    skus,
    displaySku: skus[0]?.skuCode ?? "",
    displayImageUrl: cardImage,
    displayMinPrice: minPrice.toFixed(2),
    recipeId: spu.recipeId ?? null,
  };
}
