import { jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getSetupChecklist } from "@/services/setup-checklist";

export const dynamic = "force-dynamic";

/** GET：试运营准备清单 */
export async function GET() {
  const staff = await requirePermission("business:read");
  if (isResponse(staff)) return staff;

  const result = await getSetupChecklist();
  return jsonSuccess(result);
}
