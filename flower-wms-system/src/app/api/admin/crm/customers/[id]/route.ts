import { jsonError, jsonSuccess } from "@/lib/api";
import { requirePermission, isResponse } from "@/lib/api-auth";
import { getCustomerDetail } from "@/services/crm";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const detail = await getCustomerDetail(id);

    if (!detail) {
      return jsonError("客户不存在", 404);
    }

    return jsonSuccess(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : "客户详情查询失败";
    return jsonError(message, 500);
  }
}
