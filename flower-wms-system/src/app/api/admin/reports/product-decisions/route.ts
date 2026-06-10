import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getProductDecisionReport } from "@/services/product-decision";

export const dynamic = "force-dynamic";

function parseProductDecisionParams(searchParams: URLSearchParams) {
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const preset = searchParams.get("preset");

  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("startDate 格式应为 YYYY-MM-DD");
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("endDate 格式应为 YYYY-MM-DD");
  }

  return {
    preset,
    startDate,
    endDate,
    productId: searchParams.get("productId"),
    skuId: searchParams.get("skuId"),
    categoryId: searchParams.get("categoryId"),
    status: searchParams.get("status") as "active" | "inactive" | null,
    limit: searchParams.get("limit"),
    includeInactive: searchParams.get("includeInactive"),
    includeAll: searchParams.get("includeAll"),
    targetMargin: searchParams.get("targetMargin"),
  };
}

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const params = parseProductDecisionParams(new URL(request.url).searchParams);
    const report = await getProductDecisionReport(params);
    return jsonSuccess(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "加载产品决策分析失败";
    const status = message.includes("格式应为") ? 400 : 500;
    if (status === 500) {
      console.error("[product-decisions]", err);
    }
    return jsonError(message, status);
  }
}
