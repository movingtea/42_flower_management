import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { listAuditLogs } from "@/services/audit-log";

export const dynamic = "force-dynamic";

function parseModule(value: string | null): AuditModule | null {
  if (!value) return null;
  return Object.values(AuditModule).includes(value as AuditModule)
    ? (value as AuditModule)
    : null;
}

/** GET：操作审计日志 */
export async function GET(request: Request) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "20");

    const result = await listAuditLogs({
      module: parseModule(searchParams.get("module")),
      action: searchParams.get("action"),
      entityType: searchParams.get("entityType"),
      entityId: searchParams.get("entityId"),
      actorId: searchParams.get("actorId"),
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });

    return jsonSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "查询审计日志失败";
    return jsonError(message, 500);
  }
}
