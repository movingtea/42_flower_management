import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { parseReportSearchParams } from "@/app/api/admin/reports/_params";
import { getLossModelImpactReport } from "@/services/business-report";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const params = parseReportSearchParams(new URL(request.url).searchParams);
    const report = await getLossModelImpactReport(params);
    return jsonSuccess(report);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "加载损耗模型影响报表失败";
    return jsonError(message, 500);
  }
}
