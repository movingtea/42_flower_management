import type { Prisma } from "@/generated/prisma/client";
import type { CmsProductBody } from "@/lib/cms-products";
import type { ProductEditorInitial } from "@/app/cms/products/types";
import type { ProductCategoryFlatRow } from "@/lib/product-category";
import {
  filterEditorDisplayCategoryIds,
  type ProductWithCategories,
} from "@/lib/product-categories";
import { jsonToTagKeys } from "@/lib/cms-product-tags";
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
    occasionTags: body.occasionTags ?? [],
    colorTags: body.colorTags ?? undefined,
    styleTags: body.styleTags ?? undefined,
    relationshipTags: body.relationshipTags ?? undefined,
    budgetTags: body.budgetTags ?? undefined,
    positioningTags: body.positioningTags ?? undefined,
    sellingPoints: body.sellingPoints ?? undefined,
    operationNote: body.operationNote ?? undefined,
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
    recipeId: sku.recipeId ?? null,
  }));

  const cardImage = resolveSpuCardImageUrl(spu.skus);
  const minPrice = resolveSpuMinPrice(spu.skus);

  return {
    name: spu.name,
    category: categoryForEditor,
    occasionTags: spu.occasionTags ?? [],
    colorTags: jsonToTagKeys(spu.colorTags),
    styleTags: jsonToTagKeys(spu.styleTags),
    relationshipTags: jsonToTagKeys(spu.relationshipTags),
    budgetTags: jsonToTagKeys(spu.budgetTags),
    positioningTags: jsonToTagKeys(spu.positioningTags),
    sellingPoints: jsonToTagKeys(spu.sellingPoints),
    operationNote: spu.operationNote ?? "",
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
  };
}
