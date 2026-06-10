import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getProductOperationProfile } from "@/services/cms-product-operations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const profile = await getProductOperationProfile(id);
    return jsonSuccess(profile);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "加载商品运营画像失败";
    const status = message.includes("不存在") ? 404 : 500;
    return jsonError(message, status);
  }
}
