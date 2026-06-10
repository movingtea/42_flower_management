import { ReminderStatus, ReminderType } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { requirePermission, isResponse } from "@/lib/api-auth";
import { listReminders } from "@/services/crm";

export const dynamic = "force-dynamic";

function parseStatus(value: string | null): ReminderStatus | undefined {
  if (!value) return undefined;
  if (Object.values(ReminderStatus).includes(value as ReminderStatus)) {
    return value as ReminderStatus;
  }
  return undefined;
}

function parseType(value: string | null): ReminderType | undefined {
  if (!value) return undefined;
  if (Object.values(ReminderType).includes(value as ReminderType)) {
    return value as ReminderType;
  }
  return undefined;
}

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const status = parseStatus(searchParams.get("status"));
    const type = parseType(searchParams.get("type"));
    const customerId = searchParams.get("customerId") ?? undefined;
    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate = searchParams.get("endDate") ?? undefined;
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "20");

    const data = await listReminders({
      status,
      type,
      customerId,
      startDate,
      endDate,
      page,
      pageSize,
    });

    return jsonSuccess(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "提醒列表查询失败";
    return jsonError(message, 500);
  }
}
