import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { getRecipeById, updateRecipe } from "@/services/recipe";

export const dynamic = "force-dynamic";

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("不存在")) return { message: msg, status: 404 };
    if (
      msg.includes("须为") ||
      msg.includes("缺少") ||
      msg.includes("重复") ||
      msg.includes("无效") ||
      msg.includes("至少")
    ) {
      return { message: msg, status: 400 };
    }
    return { message: msg, status: 500 };
  }
  return { message: "配方更新失败", status: 500 };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const recipe = await getRecipeById(id);
    return jsonSuccess({ recipe });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}

/** PUT：更新大仓配方物料配比 */
export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const raw = await request.json();
    const recipe = await updateRecipe(id, raw);
    return jsonSuccess({
      message: "大仓标准配方已更新",
      recipe,
    });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
