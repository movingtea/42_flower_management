import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { calculateProductMarginEstimate } from "@/services/product-margin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("business:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const productId = id?.trim();
    if (!productId) return jsonError("商品 ID 无效", 400);

    const estimate = await calculateProductMarginEstimate(productId);
    return jsonSuccess({
      message: "产品毛利预估已重新计算",
      ...estimate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "重算产品毛利预估失败";
    const status = message.includes("不存在") ? 404 : 500;
    return jsonError(message, status);
  }
}
