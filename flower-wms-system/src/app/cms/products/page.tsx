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
import { activeSpuWhere } from "@/lib/product-query";
import {
  formatMinPriceLabel,
  resolveSpuMinPrice,
} from "@/lib/product-spu";
import { prisma } from "@/lib/prisma";
import { calculateProductMarginEstimate } from "@/services/product-margin";

export const dynamic = "force-dynamic";

export default async function CmsProductsPage() {
  const [spus, categoryConfig] = await Promise.all([
    prisma.productSpu.findMany({
      where: activeSpuWhere,
      orderBy: { updatedAt: "desc" },
      include: productCategoriesInclude,
    }),
    loadCmsProductCategories(),
  ]);

  const marginResults = await Promise.all(
    spus.map((spu) =>
      calculateProductMarginEstimate(spu.id).catch(() => null)
    )
  );

  const rows: CmsProductListRow[] = spus.map((spu, index) => {
    const minPrice = resolveSpuMinPrice(spu.skus);
    const { displayPrice, priceSuffix } = formatMinPriceLabel(
      minPrice,
      spu.skus.length
    );
    const firstSku = spu.skus[0];
    const margin = marginResults[index];
    const allSkusWithoutRecipe = spu.skus.every((sku) => !sku.recipeId);
    const minMargin = margin?.summary.minGrossMargin;
    const maxMargin = margin?.summary.maxGrossMargin;
    const marginLabel = allSkusWithoutRecipe
      ? "未绑定配方"
      : margin?.summary.warningCount
        ? "成本未完整"
        : minMargin && maxMargin
          ? minMargin === maxMargin
            ? `毛利率 ${(Number(minMargin) * 100).toFixed(1)}%`
            : `毛利率 ${(Number(minMargin) * 100).toFixed(1)}%–${(
                Number(maxMargin) * 100
              ).toFixed(1)}%`
          : "成本待计算";

    return {
      id: spu.id,
      name: spu.name,
      sku: firstSku?.skuCode ?? "—",
      priceLabel: `¥${displayPrice}${priceSuffix}`,
      marginLabel,
      marginStatus: allSkusWithoutRecipe
        ? "missing"
        : margin?.summary.warningCount
          ? "warning"
          : "ok",
      quantity: spu.skus.reduce((sum, s) => sum + s.stock, 0),
      status: spu.isActive ? "PUBLISHED" : "DRAFT",
      categoryIds: categoryIdsFromProduct(spu),
    };
  });

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">商品列表</h2>
          <p className="mt-1 text-sm text-zinc-500">
            SPU 公用信息 + 多款式 SKU。删除为软删除，历史订单不受影响。
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
