import type { AuditModule } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { getAppDateRangeUtc } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

export type LogAuditEventInput = {
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  module: AuditModule;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  beforeSnapshot?: Prisma.InputJsonValue | null;
  afterSnapshot?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type ListAuditLogsParams = {
  module?: AuditModule | null;
  action?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  page?: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** 根据模块与动作生成默认中文摘要前缀 */
export function buildAuditSummary(
  module: AuditModule,
  action: string,
  detail: string
): string {
  const prefix: Record<AuditModule, string> = {
    WMS: "WMS",
    CMS: "CMS",
    CRM: "CRM",
    ORDER: "订单",
    INVENTORY: "库存",
    PURCHASE: "采购",
    REPORT: "报表",
    SYSTEM: "系统",
  };
  return `[${prefix[module] ?? module}] ${action}：${detail}`;
}

/** 写入审计日志；失败时只打 error，不抛出 */
export async function logAuditEvent(input: LogAuditEventInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId?.trim() || null,
        actorName: input.actorName?.trim() || null,
        actorRole: input.actorRole?.trim() || null,
        module: input.module,
        action: input.action.trim(),
        entityType: input.entityType.trim(),
        entityId: input.entityId?.trim() || null,
        summary: input.summary.trim(),
        beforeSnapshot: input.beforeSnapshot ?? undefined,
        afterSnapshot: input.afterSnapshot ?? undefined,
        metadata: input.metadata ?? undefined,
        ipAddress: input.ipAddress?.trim() || null,
        userAgent: input.userAgent?.trim() || null,
      },
    });
  } catch (err) {
    console.error("[audit-log] write failed", err);
  }
}

export async function listAuditLogs(params: ListAuditLogsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE)
  );

  const where: Prisma.AuditLogWhereInput = {};

  if (params.module) where.module = params.module;
  if (params.action?.trim()) where.action = params.action.trim();
  if (params.entityType?.trim()) where.entityType = params.entityType.trim();
  if (params.entityId?.trim()) where.entityId = params.entityId.trim();
  if (params.actorId?.trim()) where.actorId = params.actorId.trim();

  const range = getAppDateRangeUtc(
    params.startDate ?? undefined,
    params.endDate ?? undefined
  );
  if (range.startUtc || range.endUtcExclusive) {
    where.createdAt = {};
    if (range.startUtc) where.createdAt.gte = range.startUtc;
    if (range.endUtcExclusive) where.createdAt.lt = range.endUtcExclusive;
  }

  const [total, logs] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    logs,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0,
    },
  };
}
