import { notFound } from "next/navigation";
import { ProductEditor } from "@/app/cms/products/ProductEditor";
import type { ProductEditorInitial } from "@/app/cms/products/types";
import { productToEditorInitial } from "@/lib/cms-product-mapper";
import { loadCmsProductCategories } from "@/lib/cms-product-categories.server";
import {
  categoryKeysFromProduct,
  productCategoriesInclude,
} from "@/lib/product-categories";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const EMPTY: ProductEditorInitial = {
  sku: "",
  name: "",
  category: [],
  sellPrice: "",
  quantity: 0,
  isActive: true,
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
  const categoryOptions = await loadCmsProductCategories();

  if (isNew) {
    return (
      <ProductEditor
        productId="new"
        isNew
        initial={EMPTY}
        categoryOptions={categoryOptions}
      />
    );
  }

  const product = await prisma.product.findUnique({
    where: { id },
    include: productCategoriesInclude,
  });

  if (!product) {
    notFound();
  }

  const initial = productToEditorInitial(
    product,
    categoryKeysFromProduct(product)
  );

  return (
    <ProductEditor
      productId={id}
      isNew={false}
      initial={initial}
      categoryOptions={categoryOptions}
    />
  );
}
