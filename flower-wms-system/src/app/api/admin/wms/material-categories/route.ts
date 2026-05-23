import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import {
  parseMaterialCategoryWriteBody,
  type MaterialCategoryRow,
} from "@/lib/material-category";
import { loadMaterialCategories } from "@/lib/material-category.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function mapRow(row: {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}): MaterialCategoryRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

function mapPrismaError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return { message: "原材料分类数据冲突", status: 409 };
    if (err.code === "P2025") return { message: "原材料分类不存在", status: 404 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("不能为空") || msg.includes("无效") || msg.includes("不存在")) {
      return { message: msg, status: 400 };
    }
    return { message: msg, status: 500 };
  }
  return { message: "原材料分类操作失败", status: 500 };
}

/** GET：原材料分类扁平列表（按 sortOrder 排序） */
export async function GET() {
  try {
    const list = await loadMaterialCategories();
    return jsonSuccess({ list });
  } catch (err) {
    const { message, status } = mapPrismaError(err);
    return jsonError(message, status);
  }
}

/** POST：创建原材料分类 */
export async function POST(request: Request) {
  try {
    const body = parseMaterialCategoryWriteBody(await request.json());

    const created = await prisma.materialCategory.create({
      data: {
        name: body.name,
        description: body.description,
        sortOrder: body.sortOrder,
        isActive: body.isActive,
      },
    });

    return jsonSuccess(
      { message: "原材料分类已创建", category: mapRow(created) },
      201
    );
  } catch (err) {
    const { message, status } = mapPrismaError(err);
    return jsonError(message, status);
  }
}
