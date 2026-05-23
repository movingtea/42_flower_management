import { BannerManager } from "@/app/cms/banner/BannerManager";
import { bannerRowToWriteItem, loadActiveBanners } from "@/lib/banner.server";
import { activeProductWhere } from "@/lib/product-query";
import { PRODUCT_STATUS_PUBLISHED } from "@/lib/product-status";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CmsBannerPage() {
  const [bannerRows, products] = await Promise.all([
    loadActiveBanners(),
    prisma.product.findMany({
      where: {
        ...activeProductWhere,
        status: PRODUCT_STATUS_PUBLISHED,
        isOutOfStock: false,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true },
    }),
  ]);

  return (
    <BannerManager
      initialItems={bannerRows.map(bannerRowToWriteItem)}
      products={products}
    />
  );
}
