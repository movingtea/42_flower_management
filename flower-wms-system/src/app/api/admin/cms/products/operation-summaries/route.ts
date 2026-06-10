import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { listProductOperationSummaries } from "@/services/cms-product-operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const params = new URL(request.url).searchParams;
    const result = await listProductOperationSummaries({
      keyword: params.get("keyword"),
      categoryId: params.get("categoryId"),
      status: params.get("status") as "active" | "inactive" | null,
      occasionTag: params.get("occasionTag"),
      positioningTag: params.get("positioningTag"),
      readinessStatus: params.get("readinessStatus") as
        | "READY"
        | "WARNING"
        | "BLOCKED"
        | "INCOMPLETE"
        | null,
      page: params.get("page"),
      pageSize: params.get("pageSize"),
    });

    return jsonSuccess(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "加载商品运营摘要失败";
    return jsonError(message, 500);
  }
}
