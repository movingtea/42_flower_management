import { notFound } from "next/navigation";
import { ProductEditor } from "@/app/cms/products/ProductEditor";
import type { ProductEditorInitial } from "@/app/cms/products/types";
import { productToEditorInitial } from "@/lib/cms-product-mapper";
import {
  categoryIdsFromProduct,
  productCategoriesInclude,
} from "@/lib/product-categories";
import { loadAllProductCategoriesFlat } from "@/lib/product-category.server";
import { activeSpuWhere } from "@/lib/product-query";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const EMPTY: ProductEditorInitial = {
  name: "",
  category: [],
  description: "",
  maintenanceGuide: "",
  isActive: true,
  needsShipping: false,
  shippingFee: "",
  skus: [
    {
      specName: "标准款",
      price: "",
      stock: 0,
      imageUrl: "",
      isMainImage: true,
      sortOrder: 0,
    },
  ],
  displaySku: "",
  displayImageUrl: "",
  displayMinPrice: "0.00",
  recipeId: null,
};

export default async function CmsProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const isNew = id === "new";

  if (isNew) {
    return <ProductEditor productId="new" isNew initial={EMPTY} />;
  }

  const [spu, categoryFlat] = await Promise.all([
    prisma.productSpu.findFirst({
      where: { id, ...activeSpuWhere },
      include: productCategoriesInclude,
    }),
    loadAllProductCategoriesFlat(),
  ]);

  if (!spu) {
    notFound();
  }

  const initial = productToEditorInitial(
    spu,
    categoryIdsFromProduct(spu),
    categoryFlat
  );

  return <ProductEditor productId={id} isNew={false} initial={initial} />;
}
