import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { reorderHomeSceneEntries } from "@/services/cms-home-scene-entries";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const body = (await request.json()) as {
      items?: Array<{ id: string; sortOrder: number }>;
    };

    const items = body.items ?? [];
    if (!items.length) throw new Error("排序项不能为空");

    const entries = await reorderHomeSceneEntries(items);
    return jsonSuccess({ entries });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "排序失败";
    return jsonError(message, 500);
  }
}
