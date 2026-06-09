import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getInventoryAlertReport } from "@/services/business-report";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    return jsonSuccess(await getInventoryAlertReport());
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "加载库存预警失败", 500);
  }
}
