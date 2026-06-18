import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { buildSkuCreateRows, cmsSpuCreateData } from "@/lib/cms-product-write";
import { loadCmsProductCategories } from "@/lib/cms-product-categories.server";
import { parseCmsProductBody } from "@/lib/cms-products";
import {
  productCategoriesInclude,
  syncProductCategoryLinks,
} from "@/lib/product-categories";
import { productSpuInclude } from "@/lib/product-spu";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export { parseCmsProductBody as parseProductBody };
export type { CmsProductBody as AdminProductBody } from "@/lib/cms-products";

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return { message: "款式编码已存在", status: 409 };
    }
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("不能为空") ||
      msg.includes("无效") ||
      msg.includes("至少") ||
      msg.includes("须")
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
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const categoryConfig = await loadCmsProductCategories();
    const body = parseCmsProductBody(await request.json(), categoryConfig);

    const product = await prisma.$transaction(async (tx) => {
      const spu = await tx.productSpu.create({
        data: cmsSpuCreateData(body),
      });
      await syncProductCategoryLinks(spu.id, body.category, { tx });
      const skuRows = await buildSkuCreateRows(body, spu.id, tx);
      await tx.productSku.createMany({ data: skuRows });
      return tx.productSpu.findUniqueOrThrow({
        where: { id: spu.id },
        include: productSpuInclude,
      });
    });

    return jsonSuccess(
      { message: "商品已创建", product: { id: product.id, name: product.name } },
      201
    );
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
