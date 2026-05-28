import { jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { listActiveBatchPipeline } from "@/services/wms-stock";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await requirePermission("wms:read");
  if (isResponse(staff)) return staff;

  const items = await listActiveBatchPipeline();
  return jsonSuccess({ items });
}
