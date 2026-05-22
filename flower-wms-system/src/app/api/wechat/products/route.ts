import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { categoryKeysFromProduct, productCategoriesInclude } from "@/lib/product-categories";
import { PRODUCT_STATUS_PUBLISHED } from "@/lib/product-status";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET：小程序商品列表（?category=bouquet 按分类 key 筛选） */
export async function GET(request: Request) {
  try {
    const categoryFilter = new URL(request.url).searchParams
      .get("category")
      ?.trim()
      .toLowerCase();

    const products = await prisma.product.findMany({
      where: {
        status: PRODUCT_STATUS_PUBLISHED,
        isOutOfStock: false,
        ...(categoryFilter
          ? {
              categories: {
                some: { category: { key: categoryFilter } },
              },
            }
          : {}),
      },
      include: productCategoriesInclude,
      orderBy: { name: "asc" },
    });

    const list = products.map((p) => {
      const sellableQty = p.quantity;
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: categoryKeysFromProduct(p),
        subtitle: p.subtitle,
        images: p.images,
        detailContent: p.detailContent,
        sellPrice: p.price.toString(),
        quantity: sellableQty,
        allowPreOrder: p.allowPreOrder,
        productionTime: p.productionTime,
        totalStock: sellableQty,
        isOutOfStock: p.isOutOfStock || sellableQty <= 0,
      };
    });

    const inStock = list.filter((p) => !p.isOutOfStock);

    return jsonWechatSuccess({
      list,
      products: list,
      inStock,
      total: list.length,
      inStockCount: inStock.length,
      filterCategory: categoryFilter ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "商品列表加载失败";
    return jsonError(message, 500);
  }
}
