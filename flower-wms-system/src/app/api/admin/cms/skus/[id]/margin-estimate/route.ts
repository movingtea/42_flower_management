import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { calculateSkuMarginEstimate } from "@/services/product-margin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const skuId = id?.trim();
    if (!skuId) return jsonError("SKU ID 无效", 400);

    const estimate = await calculateSkuMarginEstimate(skuId);
    return jsonSuccess(estimate);
  } catch (err) {
    const message = err instanceof Error ? err.message : "加载 SKU 毛利预估失败";
    const status = message.includes("不存在") ? 404 : 500;
    return jsonError(message, status);
  }
}
