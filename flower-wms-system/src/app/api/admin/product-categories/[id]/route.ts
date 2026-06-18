import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import {
  collectProductCategoryDescendantIds,
  parseProductCategoryWriteBody,
} from "@/lib/product-category";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function mapPrismaError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return { message: "商品分类不存在", status: 404 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("不能为空") ||
      msg.includes("无效") ||
      msg.includes("不存在") ||
      msg.includes("不能")
    ) {
      return { message: msg, status: 400 };
    }
    return { message: msg, status: 500 };
  }
  return { message: "商品分类更新失败", status: 500 };
}

async function assertParentValidForUpdate(
  categoryId: string,
  parentId: string | null
): Promise<void> {
  if (!parentId) return;
  if (parentId === categoryId) {
    throw new Error("上级分类不能选择自身");
  }
  const parent = await prisma.productCategory.findUnique({
    where: { id: parentId },
    select: { id: true },
  });
  if (!parent) throw new Error("上级商品分类不存在");

  const all = await prisma.productCategory.findMany({
    select: { id: true, parentId: true },
  });
  const descendants = collectProductCategoryDescendantIds(categoryId, all);
  if (descendants.has(parentId)) {
    throw new Error("上级分类不能选择当前分类的子分类");
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const body = parseProductCategoryWriteBody(await request.json());

    const existing = await prisma.productCategory.findUnique({ where: { id } });
    if (!existing) return jsonError("商品分类不存在", 404);

    await assertParentValidForUpdate(id, body.parentId);

    const updated = await prisma.productCategory.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
        sortOrder: body.sortOrder,
        parentId: body.parentId,
        isActive: body.isActive,
        imageUrl: body.imageUrl,
      },
    });

    return jsonSuccess({ message: "商品分类已更新", category: updated });
  } catch (err) {
    const { message, status } = mapPrismaError(err);
    return jsonError(message, status);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;

    const existing = await prisma.productCategory.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });

    if (!existing) return jsonError("商品分类不存在", 404);

    if (existing._count.products > 0) {
      return jsonError("该分类下仍有关联商品，请先解除商品关联", 400);
    }

    await prisma.productCategory.delete({ where: { id } });

    return jsonSuccess({ message: "商品分类已删除" });
  } catch (err) {
    const { message, status } = mapPrismaError(err);
    return jsonError(message, status);
  }
}
