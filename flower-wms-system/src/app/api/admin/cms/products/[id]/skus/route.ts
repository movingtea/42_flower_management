import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { listProductSkusForPicker } from "@/services/cms-product-operations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const items = await listProductSkusForPicker(id);
    return jsonSuccess({ items });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "SKU 列表加载失败";
    return jsonError(message, 500);
  }
}
