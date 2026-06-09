import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { backfillMissingOrderCostSnapshots } from "@/services/business-report";
import { parseReportSearchParams } from "../_params";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    return jsonSuccess(
      await backfillMissingOrderCostSnapshots(parseReportSearchParams(searchParams))
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "补算成本快照失败", 500);
  }
}
