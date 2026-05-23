import { BannerManager } from "@/app/cms/banner/BannerManager";
import { bannerRowToWriteItem, loadActiveBanners } from "@/lib/banner.server";
import { activeProductWhere } from "@/lib/product-query";
import { PRODUCT_STATUS_PUBLISHED } from "@/lib/product-status";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CmsBannerPage() {
  const [bannerRows, products] = await Promise.all([
    loadActiveBanners(),
    prisma.productSpu.findMany({
      where: {
        ...activeProductWhere,
        isActive: true,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, skus: { select: { skuCode: true } } },
    }),
  ]);

  return (
    <BannerManager
      initialItems={bannerRows.map(bannerRowToWriteItem)}
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.skus[0]?.skuCode ?? "—",
      }))}
    />
  );
}
