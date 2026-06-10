import type { Role } from "@/generated/prisma/enums";
import type { StaffSession } from "@/lib/api-auth";
import {
  logAuditEvent,
  type LogAuditEventInput,
} from "@/services/audit-log";

export function actorFromStaff(staff: StaffSession): Pick<
  LogAuditEventInput,
  "actorId" | "actorName" | "actorRole"
> {
  return {
    actorId: staff.id,
    actorName: staff.username,
    actorRole: staff.role as Role,
  };
}

export function requestMeta(request?: Request): Pick<
  LogAuditEventInput,
  "ipAddress" | "userAgent"
> {
  if (!request) return {};
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || null;
  return {
    ipAddress: ip,
    userAgent: request.headers.get("user-agent"),
  };
}

/** 异步写审计，失败不影响主流程 */
export function safeLogAudit(input: LogAuditEventInput): void {
  void logAuditEvent(input);
}

export function safeLogAuditFromStaff(
  staff: StaffSession,
  input: Omit<LogAuditEventInput, "actorId" | "actorName" | "actorRole">,
  request?: Request
): void {
  safeLogAudit({
    ...actorFromStaff(staff),
    ...requestMeta(request),
    ...input,
  });
}
