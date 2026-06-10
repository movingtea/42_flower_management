import { AuditModule, ReminderStatus } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { requirePermission, isResponse } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { coerceDate } from "@/lib/datetime";
import { updateReminderStatus } from "@/services/crm";

export const dynamic = "force-dynamic";

function parseStatus(value: unknown): ReminderStatus {
  if (
    typeof value === "string" &&
    Object.values(ReminderStatus).includes(value as ReminderStatus)
  ) {
    return value as ReminderStatus;
  }
  throw new Error("status 无效");
}

function parseBody(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const b = raw as Record<string, unknown>;
  const status = parseStatus(b.status);
  const note = typeof b.note === "string" ? b.note : undefined;
  const snoozedUntil =
    typeof b.snoozedUntil === "string"
      ? coerceDate(b.snoozedUntil)
      : b.snoozedUntil instanceof Date
        ? b.snoozedUntil
        : undefined;

  return { status, note, snoozedUntil };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("business:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体", 400);
    }

    const body = parseBody(raw);
    const reminder = await updateReminderStatus(id, body.status, {
      note: body.note,
      snoozedUntil: body.snoozedUntil,
    });

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.CRM,
        action: "REMINDER_STATUS_UPDATE",
        entityType: "CustomerReminder",
        entityId: reminder.id,
        summary: `复购提醒状态更新为 ${body.status}`,
        afterSnapshot: { status: reminder.status },
      },
      request
    );

    return jsonSuccess({ reminder });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新提醒失败";
    const status = message.includes("无效") ? 400 : 500;
    return jsonError(message, status);
  }
}
