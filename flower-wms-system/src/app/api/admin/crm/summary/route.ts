import { jsonError, jsonSuccess } from "@/lib/api";
import { requirePermission, isResponse } from "@/lib/api-auth";
import { getCrmSummary } from "@/services/crm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const data = await getCrmSummary();
    return jsonSuccess(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "CRM 总览加载失败";
    return jsonError(message, 500);
  }
}
