import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import {
  createRecipe,
  getRecipeById,
  listRecipes,
} from "@/services/recipe";

export const dynamic = "force-dynamic";

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return { message: "配方流水号冲突，请重试", status: 409 };
    }
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("不存在") ||
      msg.includes("须为") ||
      msg.includes("缺少") ||
      msg.includes("重复") ||
      msg.includes("无效") ||
      msg.includes("不能为空") ||
      msg.includes("至少")
    ) {
      return { message: msg, status: 400 };
    }
    return { message: msg, status: 500 };
  }
  return { message: "配方操作失败", status: 500 };
}

/** GET：独立配方列表；?id= 返回单条详情 */
export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    if (id) {
      const recipe = await getRecipeById(id);
      return jsonSuccess({ recipe });
    }

    const items = await listRecipes();
    return jsonSuccess({ items });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}

/** POST：创建新标准配方 */
export async function POST(request: Request) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const raw = await request.json();
    const recipe = await createRecipe(raw);
    return jsonSuccess(
      {
        message: `配方创建成功，系统单号：${recipe.recipeCode}`,
        recipe,
      },
      201
    );
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
