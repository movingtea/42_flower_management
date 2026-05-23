import { notFound } from "next/navigation";
import { ProductEditor } from "@/app/cms/products/ProductEditor";
import type { ProductEditorInitial } from "@/app/cms/products/types";
import { productToEditorInitial } from "@/lib/cms-product-mapper";
import {
  categoryIdsFromProduct,
  productCategoriesInclude,
} from "@/lib/product-categories";
import { loadAllProductCategoriesFlat } from "@/lib/product-category.server";
import { activeProductWhere } from "@/lib/product-query";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const EMPTY: ProductEditorInitial = {
  sku: "",
  name: "",
  category: [],
  sellPrice: "",
  quantity: 0,
  isActive: true,
  needsShipping: false,
  shippingFee: "",
  description: "",
  careTips: "",
  imageUrl: "",
};

export default async function CmsProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const isNew = id === "new";

  if (isNew) {
    return (
      <ProductEditor productId="new" isNew initial={EMPTY} />
    );
  }

  const [product, categoryFlat] = await Promise.all([
    prisma.product.findFirst({
      where: { id, ...activeProductWhere },
      include: productCategoriesInclude,
    }),
    loadAllProductCategoriesFlat(),
  ]);

  if (!product) {
    notFound();
  }

  const initial = productToEditorInitial(
    product,
    categoryIdsFromProduct(product),
    categoryFlat
  );

  return (
    <ProductEditor productId={id} isNew={false} initial={initial} />
  );
}
