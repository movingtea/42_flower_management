export type AuditSearchParams = {
  action?: string | string[];
  entityType?: string | string[];
  entityId?: string | string[];
  actor?: string | string[];
  startDate?: string | string[];
  endDate?: string | string[];
  page?: string | string[];
};

export type AuditFilters = {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorStaffId?: string;
  startDate?: string;
  endDate?: string;
  page: number;
};

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function text(value: string | undefined, max = 120): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function dateKey(value: string | undefined): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  // Reject impossible calendar dates (2026-02-31 would otherwise roll over into
  // March in the shared UTC range helper and silently filter the wrong day).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseAuditFilters(params: AuditSearchParams): AuditFilters {
  const parsedPage = Number(single(params.page));
  return {
    action: text(single(params.action)),
    entityType: text(single(params.entityType)),
    entityId: text(single(params.entityId)),
    actorStaffId: text(single(params.actor)),
    startDate: dateKey(single(params.startDate)),
    endDate: dateKey(single(params.endDate)),
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  };
}

export function buildAuditHref(filters: AuditFilters, page = filters.page): string {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.entityId) params.set("entityId", filters.entityId);
  if (filters.actorStaffId) params.set("actor", filters.actorStaffId);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (page > 1) params.set("page", String(page));
  const serialized = params.toString();
  return serialized ? `/v2/audit?${serialized}` : "/v2/audit";
}
