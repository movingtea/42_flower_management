import { BannerManager } from "@/app/cms/banner/BannerManager";
import {
  HOME_BANNER_KEY,
  parseHomeBannerValue,
} from "@/lib/home-banner";
import { PRODUCT_STATUS_PUBLISHED } from "@/lib/product-status";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CmsBannerPage() {
  const [config, products] = await Promise.all([
    prisma.appConfig.findUnique({ where: { key: HOME_BANNER_KEY } }),
    prisma.product.findMany({
      where: { status: PRODUCT_STATUS_PUBLISHED, isOutOfStock: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true },
    }),
  ]);

  const initialItems = parseHomeBannerValue(config?.value ?? []);

  return (
    <BannerManager
      initialItems={initialItems}
      products={products}
      updatedAt={config?.updatedAt.toISOString() ?? null}
    />
  );
}
