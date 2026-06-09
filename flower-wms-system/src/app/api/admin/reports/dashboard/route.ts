import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getBusinessDashboardReport } from "@/services/business-report";
import { parseReportSearchParams } from "../_params";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const data = await getBusinessDashboardReport(parseReportSearchParams(searchParams));
    return jsonSuccess(data);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "加载经营报表失败", 500);
  }
}
