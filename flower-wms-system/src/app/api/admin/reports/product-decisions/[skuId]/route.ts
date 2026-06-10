import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getProductDecisionDetail } from "@/services/product-decision";

export const dynamic = "force-dynamic";

function parseDetailParams(searchParams: URLSearchParams) {
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("startDate 格式应为 YYYY-MM-DD");
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("endDate 格式应为 YYYY-MM-DD");
  }

  return {
    preset: searchParams.get("preset"),
    startDate,
    endDate,
    targetMargin: searchParams.get("targetMargin"),
    includeInactive: searchParams.get("includeInactive"),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ skuId: string }> }
) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const { skuId } = await context.params;
    const detail = await getProductDecisionDetail(
      skuId,
      parseDetailParams(new URL(request.url).searchParams)
    );
    return jsonSuccess(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : "加载产品决策详情失败";
    const status =
      message.includes("格式应为") ? 400 : message.includes("不存在") ? 404 : 500;
    if (status === 500) {
      console.error("[product-decisions/detail]", err);
    }
    return jsonError(message, status);
  }
}
