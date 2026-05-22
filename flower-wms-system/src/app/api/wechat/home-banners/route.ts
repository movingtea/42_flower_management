import { jsonWechatSuccess } from "@/lib/wechat-api";
import {
  HOME_BANNER_KEY,
  parseHomeBannerValue,
} from "@/lib/home-banner";
import { PRODUCT_STATUS_PUBLISHED } from "@/lib/product-status";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET：小程序首页轮播（仅已上架成品） */
export async function GET() {
  const row = await prisma.appConfig.findUnique({
    where: { key: HOME_BANNER_KEY },
  });

  const items = parseHomeBannerValue(row?.value ?? []);
  if (items.length === 0) {
    return jsonWechatSuccess({ list: [], total: 0 });
  }

  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      status: PRODUCT_STATUS_PUBLISHED,
      isOutOfStock: false,
    },
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      images: true,
    },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const list = items
    .filter((item) => productMap.has(item.productId))
    .map((item) => {
      const p = productMap.get(item.productId)!;
      return {
        id: item.id,
        imageUrl: item.imageUrl,
        sort: item.sort,
        productId: item.productId,
        product: {
          id: p.id,
          name: p.name,
          sku: p.sku,
          sellPrice: p.price.toString(),
          imageUrl: p.images[0] ?? null,
        },
      };
    });

  return jsonWechatSuccess({ list, total: list.length });
}
