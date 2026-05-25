import { jsonSuccess } from "@/lib/api";
import { listActiveBatchPipeline } from "@/services/wms-stock";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listActiveBatchPipeline();
  return jsonSuccess({ items });
}
