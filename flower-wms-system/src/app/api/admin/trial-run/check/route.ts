import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { runTrialRunCheck } from "@/services/trial-run-check";

export const dynamic = "force-dynamic";

/** GET：端到端试运营链路检查（dry-run） */
export async function GET() {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const result = await runTrialRunCheck();
    return jsonSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "试运营检查失败";
    return jsonError(message, 500);
  }
}
