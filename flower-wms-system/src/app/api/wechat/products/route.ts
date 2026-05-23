import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { activeSpuWhere } from "@/lib/product-query";
import { productSpuInclude } from "@/lib/product-spu";
import { mapSpuToWechatListItem } from "@/lib/wechat-product-mapper";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET：小程序商品列表（?category= &keyword=） */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const categoryFilter = params.get("category")?.trim();
    const keyword = params.get("keyword")?.trim();

    const spus = await prisma.productSpu.findMany({
      where: {
        ...activeSpuWhere,
        isActive: true,
        ...(categoryFilter
          ? {
              categories: {
                some: { productCategoryId: categoryFilter },
              },
            }
          : {}),
        ...(keyword
          ? {
              OR: [
                { name: { contains: keyword, mode: "insensitive" } },
                { description: { contains: keyword, mode: "insensitive" } },
                {
                  skus: {
                    some: {
                      OR: [
                        { specName: { contains: keyword, mode: "insensitive" } },
                        { skuCode: { contains: keyword, mode: "insensitive" } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: productSpuInclude,
      orderBy: { name: "asc" },
    });

    const list = spus.map(mapSpuToWechatListItem);
    const inStock = list.filter((p) => !p.isOutOfStock);

    return jsonWechatSuccess({
      list,
      products: list,
      inStock,
      total: list.length,
      inStockCount: inStock.length,
      filterCategory: categoryFilter ?? null,
      keyword: keyword ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "商品列表加载失败";
    return jsonError(message, 500);
  }
}
