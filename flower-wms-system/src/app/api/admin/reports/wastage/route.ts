import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getWastageReport } from "@/services/business-report";
import { parseReportSearchParams } from "../_params";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    return jsonSuccess(await getWastageReport(parseReportSearchParams(searchParams)));
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "加载花材损耗失败", 500);
  }
}
