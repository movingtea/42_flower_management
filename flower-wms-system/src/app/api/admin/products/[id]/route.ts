import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { cmsProductUpdateData } from "@/lib/cms-product-write";
import { loadCmsProductCategories } from "@/lib/cms-product-categories.server";
import { parseCmsProductBody } from "@/lib/cms-products";
import {
  productCategoriesInclude,
  syncProductCategoryLinks,
} from "@/lib/product-categories";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return { message: "SKU 已存在", status: 409 };
    if (err.code === "P2025") return { message: "商品不存在", status: 404 };
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
  return { message: "更新失败", status: 500 };
}

/** @deprecated 请使用 PUT /api/cms/products/[id] */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const categoryConfig = await loadCmsProductCategories();
    const body = parseCmsProductBody(await request.json(), categoryConfig);

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return jsonError("成品商品不存在", 404);
    }

    const product = await prisma.$transaction(async (tx) => {
      await syncProductCategoryLinks(id, body.category, { tx });

      return tx.product.update({
        where: { id },
        data: cmsProductUpdateData(body),
        include: productCategoriesInclude,
      });
    });

    return jsonSuccess({
      message: "商品已更新",
      product: { id: product.id, sku: product.sku },
    });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
