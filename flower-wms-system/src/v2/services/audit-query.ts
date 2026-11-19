import type { Prisma, PrismaClient } from "../../generated/prisma-v2/client";
import { getAppDateRangeUtc } from "@/lib/datetime";
import { summarizeAuditChange, type AuditChangeSummary } from "../domain/audit-diff";

export type V2AuditScope = { tenantId: string; storeId: string };

export type AuditQueryParams = {
  action?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorStaffId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  page?: number;
  pageSize?: number;
};

export type AuditRow = {
  id: string;
  occurredAt: Date;
  storeId: string | null;
  actorStaffId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  change: AuditChangeSummary;
};

export type AuditQueryResult = {
  rows: AuditRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

function clean(value: string | null | undefined, max = 120): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, max) : undefined;
}

export async function listV2AuditEvents(
  db: PrismaClient,
  scope: V2AuditScope,
  params: AuditQueryParams = {},
): Promise<AuditQueryResult> {
  const requestedPage = Math.trunc(params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE));

  const conditions: Prisma.AuditEventWhereInput[] = [];
  const action = clean(params.action);
  const entityType = clean(params.entityType);
  const entityId = clean(params.entityId);
  const actorStaffId = clean(params.actorStaffId);
  if (action) conditions.push({ action: { contains: action, mode: "insensitive" } });
  if (entityType) conditions.push({ entityType: { contains: entityType, mode: "insensitive" } });
  if (entityId) conditions.push({ entityId: { contains: entityId, mode: "insensitive" } });
  if (actorStaffId) conditions.push({ actorStaffId });

  const range = getAppDateRangeUtc(params.startDate, params.endDate);
  if (range.startUtc || range.endUtcExclusive) {
    conditions.push({
      occurredAt: {
        ...(range.startUtc ? { gte: range.startUtc } : {}),
        ...(range.endUtcExclusive ? { lt: range.endUtcExclusive } : {}),
      },
    });
  }

  const where: Prisma.AuditEventWhereInput = {
    tenantId: scope.tenantId,
    // Tenant-level events (storeId null) are relevant to every store; only the
    // active store's own events are included besides those.
    OR: [{ storeId: scope.storeId }, { storeId: null }],
    ...(conditions.length > 0 ? { AND: conditions } : {}),
  };

  // Count first so an out-of-range or huge `page` deep link is clamped to the
  // last real page instead of producing an empty, misleading "no events" view
  // (and instead of building a skip value the database cannot fit).
  const total = await db.auditEvent.count({ where });
  const totalPages = Math.ceil(total / pageSize);
  const page = totalPages === 0
    ? 1
    : Math.min(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1, totalPages);

  const events = await db.auditEvent.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const actorIds = [...new Set(events.map((event) => event.actorStaffId).filter((id): id is string => Boolean(id)))];
  const staff = actorIds.length === 0
    ? []
    : await db.staffUser.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, displayName: true, username: true },
      });
  const staffById = new Map(staff.map((user) => [user.id, user]));

  return {
    rows: events.map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt,
      storeId: event.storeId,
      actorStaffId: event.actorStaffId,
      actorName: event.actorStaffId
        ? staffById.get(event.actorStaffId)?.displayName
          ?? staffById.get(event.actorStaffId)?.username
          ?? event.actorStaffId
        : null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      beforeSnapshot: event.beforeSnapshot,
      afterSnapshot: event.afterSnapshot,
      change: summarizeAuditChange(event.beforeSnapshot, event.afterSnapshot),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

/** Read-only query used by the audit page filter to suggest existing actions. */
export async function listAuditActions(
  db: PrismaClient,
  scope: V2AuditScope,
  take = 40,
): Promise<string[]> {
  const rows = await db.auditEvent.findMany({
    where: { tenantId: scope.tenantId, OR: [{ storeId: scope.storeId }, { storeId: null }] },
    distinct: ["action"],
    orderBy: { action: "asc" },
    select: { action: true },
    take,
  });
  return rows.map((row) => row.action);
}
