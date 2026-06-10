import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getSystemHealth } from "@/services/system-health";

export const dynamic = "force-dynamic";

/** GET：系统健康检查 */
export async function GET() {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const result = await getSystemHealth();
    return jsonSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "健康检查失败";
    return jsonError(message, 500);
  }
}
