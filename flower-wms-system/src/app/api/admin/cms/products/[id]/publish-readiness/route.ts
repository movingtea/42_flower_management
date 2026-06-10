import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { validateProductForPublish } from "@/services/cms-product-operations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const result = await validateProductForPublish(id);
    return jsonSuccess(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "商品上架校验失败";
    const status = message.includes("不存在") ? 404 : 500;
    return jsonError(message, status);
  }
}
