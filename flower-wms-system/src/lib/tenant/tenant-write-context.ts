const DEFAULT_TENANT_ID = "universe42";

/**
 * Injects constant tenantId on write payloads (Sprint 23-A).
 * Does not read request/session; does not affect read paths.
 */
export function withTenant<T extends object>(
  data: T
): T & { tenantId: string } {
  return {
    ...data,
    tenantId: DEFAULT_TENANT_ID,
  };
}

export function withTenantMany<T extends object>(
  rows: T[]
): (T & { tenantId: string })[] {
  return rows.map(withTenant);
}

export { DEFAULT_TENANT_ID };
