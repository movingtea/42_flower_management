import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import {
  GLOBAL_NOTICE_KEY,
  HOME_POPUP_KEY,
  defaultGlobalNotice,
  defaultHomePopup,
  parseGlobalNoticeValue,
  parseHomePopupValue,
} from "@/lib/app-marketing";
import { CMS_PRODUCT_CATEGORIES_KEY } from "@/lib/cms-product-categories";
import { loadCmsProductCategories } from "@/lib/cms-product-categories.server";
import { HOME_BANNER_KEY, parseHomeBannerValue } from "@/lib/home-banner";
import { PRODUCT_STATUS_PUBLISHED } from "@/lib/product-status";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CONFIG_KEYS = [
  HOME_BANNER_KEY,
  GLOBAL_NOTICE_KEY,
  HOME_POPUP_KEY,
  CMS_PRODUCT_CATEGORIES_KEY,
] as const;

/** GET：小程序首页超级接口（轮播 + 公告 + 弹窗 + 分类） */
export async function GET() {
  try {
    const [rows, categories] = await Promise.all([
      prisma.appConfig.findMany({
        where: { key: { in: [...CONFIG_KEYS] } },
      }),
      loadCmsProductCategories(),
    ]);

    const valueByKey = new Map(rows.map((r) => [r.key, r.value]));

    const bannerItems = parseHomeBannerValue(
      valueByKey.get(HOME_BANNER_KEY) ?? null
    );

    let banners: {
      id: string;
      imageUrl: string;
      sort: number;
      productId: string;
      product: {
        id: string;
        name: string;
        sku: string;
        sellPrice: string | null;
        imageUrl: string | null;
        images: string[];
      } | null;
    }[] = [];

    if (bannerItems.length > 0) {
      const productIds = [...new Set(bannerItems.map((i) => i.productId))];
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

      banners = bannerItems
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
              images: p.images,
            },
          };
        });
    }

    const notice = valueByKey.has(GLOBAL_NOTICE_KEY)
      ? parseGlobalNoticeValue(valueByKey.get(GLOBAL_NOTICE_KEY))
      : defaultGlobalNotice();

    const popup = valueByKey.has(HOME_POPUP_KEY)
      ? parseHomePopupValue(valueByKey.get(HOME_POPUP_KEY))
      : defaultHomePopup();

    return jsonWechatSuccess({
      banners,
      categories,
      notice,
      popup,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "首页配置加载失败";
    return jsonError(message, 500);
  }
}
