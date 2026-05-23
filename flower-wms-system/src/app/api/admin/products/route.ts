import { jsonError, jsonSuccess } from "@/lib/api";
import { cmsProductCreateData } from "@/lib/cms-product-write";
import { generateUniqueSku } from "@/utils/skuGenerator";
import { loadCmsProductCategories } from "@/lib/cms-product-categories.server";
import { parseCmsProductBody } from "@/lib/cms-products";
import {
  productCategoriesInclude,
  resolveProductCategoryIdsForSave,
} from "@/lib/product-categories";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export { parseCmsProductBody as parseProductBody };
export type { CmsProductBody as AdminProductBody } from "@/lib/cms-products";

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("不能为空") ||
      msg.includes("无效") ||
      msg.includes("至少")
    ) {
      return { message: msg, status: 400 };
    }
    return { message: msg, status: 500 };
  }
  return { message: "保存失败", status: 500 };
}

/** @deprecated 请使用 POST /api/cms/products */
export async function POST(request: Request) {
  try {
    const categoryConfig = await loadCmsProductCategories();
    const body = parseCmsProductBody(await request.json(), categoryConfig);

    const categoryIds = await resolveProductCategoryIdsForSave(body.category);

    const sku = await generateUniqueSku("product");

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: cmsProductCreateData(body, sku),
      });

      await tx.productCategoryRelation.createMany({
        data: categoryIds.map((productCategoryId) => ({
          productId: created.id,
          productCategoryId,
        })),
        skipDuplicates: true,
      });

      return tx.product.findUniqueOrThrow({
        where: { id: created.id },
        include: productCategoriesInclude,
      });
    });

    return jsonSuccess(
      {
        message: "商品已创建",
        product: { id: product.id, sku: product.sku },
      },
      201
    );
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
