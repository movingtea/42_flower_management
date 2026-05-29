import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import {
  parseSkuMarketingPatch,
  updateSkuMarketingOnly,
} from "@/lib/cms-sku-marketing";
import { ForbiddenError, requirePermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof ForbiddenError) {
    return { message: err.message, status: 403 };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      return { message: "SKU 不存在", status: 404 };
    }
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("不存在") || msg.includes("已删除")) {
      return { message: msg, status: 404 };
    }
    if (
      msg.includes("不允许") ||
      msg.includes("须为") ||
      msg.includes("请至少")
    ) {
      return { message: msg, status: 400 };
    }
    return { message: msg, status: 500 };
  }
  return { message: "更新失败", status: 500 };
}

/**
 * PATCH：运营人员仅可修改 SKU 营销图文（description / imageUrl）。
 * 需 STORE_OPERATOR 及以上角色（含店长 STORE_MANAGER）。
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requirePermission(request, "STORE_OPERATOR");

    const { id: skuId } = await context.params;
    if (!skuId?.trim()) {
      return jsonError("SKU ID 无效", 400);
    }

    const patch = parseSkuMarketingPatch(await request.json());
    const sku = await updateSkuMarketingOnly(skuId.trim(), patch);

    return jsonSuccess({
      message: "SKU 营销图文已更新",
      sku,
    });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
