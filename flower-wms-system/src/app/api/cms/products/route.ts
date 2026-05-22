import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { cmsProductCreateData } from "@/lib/cms-product-write";
import { generateUniqueSku } from "@/utils/skuGenerator";
import { loadCmsProductCategories } from "@/lib/cms-product-categories.server";
import { parseCmsProductBody } from "@/lib/cms-products";
import {
  cmsLabelByKey,
  ensureCategoryIdsByKeys,
  productCategoriesInclude,
} from "@/lib/product-categories";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return { message: "SKU 已存在", status: 409 };
    }
  }
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

/** POST：创建 CMS 成品商品 */
export async function POST(request: Request) {
  try {
    const categoryConfig = await loadCmsProductCategories();
    const body = parseCmsProductBody(await request.json(), categoryConfig);

    const labelByKey = cmsLabelByKey(categoryConfig);
    const categoryIds = await ensureCategoryIdsByKeys(body.category, {
      labelByKey,
    });

    const sku = await generateUniqueSku("product");

    const product = await prisma.product.create({
      data: {
        ...cmsProductCreateData(body, sku),
        categories: {
          create: categoryIds.map((categoryId) => ({ categoryId })),
        },
      },
      include: productCategoriesInclude,
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
