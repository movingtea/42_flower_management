import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import {
  buildProductCategoryTree,
  parseProductCategoryWriteBody,
  type ProductCategoryFlatRow,
} from "@/lib/product-category";
import { loadAllProductCategoriesFlat } from "@/lib/product-category.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function mapRow(row: {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
  isActive: boolean;
  imageUrl: string | null;
}): ProductCategoryFlatRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    parentId: row.parentId,
    isActive: row.isActive,
    imageUrl: row.imageUrl,
  };
}

function mapPrismaError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return { message: "商品分类数据冲突", status: 409 };
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
  return { message: "商品分类操作失败", status: 500 };
}

async function assertParentValid(
  parentId: string | null,
  excludeId?: string
): Promise<void> {
  if (!parentId) return;
  if (excludeId && parentId === excludeId) {
    throw new Error("上级分类不能选择自身");
  }
  const parent = await prisma.productCategory.findUnique({
    where: { id: parentId },
    select: { id: true },
  });
  if (!parent) throw new Error("上级商品分类不存在");
}

/** GET：商品分类树（按 sortOrder 排序，含 children） */
export async function GET() {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const flat = await loadAllProductCategoriesFlat();
    const tree = buildProductCategoryTree(flat);

    const rootsWithChildren = await prisma.productCategory.findMany({
      where: { parentId: null },
      orderBy: { sortOrder: "asc" },
      include: {
        children: {
          orderBy: { sortOrder: "asc" },
          include: {
            children: { orderBy: { sortOrder: "asc" } },
          },
        },
      },
    });

    return jsonSuccess({ tree, flat, roots: rootsWithChildren });
  } catch (err) {
    const { message, status } = mapPrismaError(err);
    return jsonError(message, status);
  }
}

/** POST：创建商品分类 */
export async function POST(request: Request) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const body = parseProductCategoryWriteBody(await request.json());
    await assertParentValid(body.parentId);

    const created = await prisma.productCategory.create({
      data: {
        name: body.name,
        description: body.description,
        sortOrder: body.sortOrder,
        parentId: body.parentId,
        isActive: body.isActive,
        imageUrl: body.imageUrl,
      },
    });

    return jsonSuccess(
      { message: "商品分类已创建", category: mapRow(created) },
      201
    );
  } catch (err) {
    const { message, status } = mapPrismaError(err);
    return jsonError(message, status);
  }
}
