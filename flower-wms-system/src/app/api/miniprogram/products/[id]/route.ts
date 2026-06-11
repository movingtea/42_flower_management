import { jsonError } from "@/lib/api";
import { MINIPROGRAM_ERROR_CODES } from "@/lib/miniprogram-business-error";
import { activeSpuWhere } from "@/lib/product-query";
import { hasActiveSku, productSpuInclude } from "@/lib/product-spu";
import {
  mapSpuToWechatListItem,
  resolveBannerImagesFromSkus,
} from "@/lib/wechat-product-mapper";
import { jsonWechatError, jsonWechatSuccess } from "@/lib/wechat-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET：小程序商品详情 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const spu = await prisma.productSpu.findFirst({
      where: {
        id,
        ...activeSpuWhere,
        isActive: true,
      },
      include: productSpuInclude,
    });

    if (!spu) {
      return jsonWechatError(
        "商品不存在或已下架",
        404,
        MINIPROGRAM_ERROR_CODES.PRODUCT_OFF_SHELF
      );
    }

    if (!hasActiveSku(spu.skus)) {
      return jsonWechatError(
        "该商品暂不可售",
        404,
        MINIPROGRAM_ERROR_CODES.SKU_INACTIVE
      );
    }

    const product = mapSpuToWechatListItem(spu);
    if (!product.skus.length) {
      return jsonWechatError(
        "该商品暂不可售",
        404,
        MINIPROGRAM_ERROR_CODES.SKU_INACTIVE
      );
    }

    const bannerImages = resolveBannerImagesFromSkus(product.skus);

    return jsonWechatSuccess({
      product,
      bannerImages:
        bannerImages.length > 0 ? bannerImages : product.images,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "商品详情加载失败";
    return jsonError(message, 500);
  }
}
