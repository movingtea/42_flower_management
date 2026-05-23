import Link from "next/link";
import {
  CmsProductsTable,
  type CmsProductListRow,
} from "@/app/cms/products/CmsProductsTable";
import { loadCmsProductCategories } from "@/lib/cms-product-categories.server";
import {
  categoryIdsFromProduct,
  productCategoriesInclude,
} from "@/lib/product-categories";
import { activeProductWhere } from "@/lib/product-query";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CmsProductsPage() {
  const [products, categoryConfig] = await Promise.all([
    prisma.product.findMany({
      where: activeProductWhere,
      orderBy: { updatedAt: "desc" },
      include: productCategoriesInclude,
    }),
    loadCmsProductCategories(),
  ]);

  const rows: CmsProductListRow[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    priceLabel: p.price ? `¥${p.price}` : "¥0",
    quantity: p.quantity,
    status: p.status,
    categoryIds: categoryIdsFromProduct(p),
  }));

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">商品列表</h2>
          <p className="mt-1 text-sm text-zinc-500">
            用于管理商品信息。删除为软删除，历史订单数据不受影响。
          </p>
        </div>
        <Link
          href="/cms/products/new"
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
        >
          + 新增商品
        </Link>
      </header>

      <CmsProductsTable rows={rows} categoryConfig={categoryConfig} />
    </div>
  );
}
