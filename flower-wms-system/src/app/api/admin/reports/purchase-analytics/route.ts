import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getPurchaseAnalyticsReport } from "@/services/purchase-analytics";

export const dynamic = "force-dynamic";

function parsePurchaseAnalyticsParams(searchParams: URLSearchParams) {
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const supplierId = searchParams.get("supplierId");
  const flowerWikiId = searchParams.get("flowerWikiId");
  const limit = searchParams.get("limit");
  const includeDraft = searchParams.get("includeDraft");

  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("startDate 格式应为 YYYY-MM-DD");
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("endDate 格式应为 YYYY-MM-DD");
  }

  return {
    startDate,
    endDate,
    supplierId,
    flowerWikiId,
    limit,
    includeDraft,
  };
}

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const params = parsePurchaseAnalyticsParams(new URL(request.url).searchParams);
    const report = await getPurchaseAnalyticsReport(params);
    return jsonSuccess(report);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "加载采购复盘分析失败";
    const status = message.includes("格式应为") ? 400 : 500;
    if (status === 500) {
      console.error("[purchase-analytics]", err);
    }
    return jsonError(message, status);
  }
}
