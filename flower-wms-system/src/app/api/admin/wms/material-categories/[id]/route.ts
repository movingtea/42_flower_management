import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { parseMaterialCategoryWriteBody } from "@/lib/material-category";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function mapPrismaError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return { message: "原材料分类不存在", status: 404 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("不能为空") || msg.includes("无效") || msg.includes("不存在")) {
      return { message: msg, status: 400 };
    }
    return { message: msg, status: 500 };
  }
  return { message: "原材料分类更新失败", status: 500 };
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = parseMaterialCategoryWriteBody(await request.json());

    const existing = await prisma.materialCategory.findUnique({ where: { id } });
    if (!existing) return jsonError("原材料分类不存在", 404);

    const updated = await prisma.materialCategory.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
        sortOrder: body.sortOrder,
        isActive: body.isActive,
      },
    });

    return jsonSuccess({ message: "原材料分类已更新", category: updated });
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
    const { id } = await context.params;

    const existing = await prisma.materialCategory.findUnique({
      where: { id },
      include: { _count: { select: { materials: true } } },
    });

    if (!existing) return jsonError("原材料分类不存在", 404);

    if (existing._count.materials > 0) {
      return jsonError("该分类下仍有关联原材料，请先解除关联", 400);
    }

    await prisma.materialCategory.delete({ where: { id } });

    return jsonSuccess({ message: "原材料分类已删除" });
  } catch (err) {
    const { message, status } = mapPrismaError(err);
    return jsonError(message, status);
  }
}
