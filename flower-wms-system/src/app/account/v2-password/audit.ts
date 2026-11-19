/**
 * Pure helpers for the V2 first-login password change.
 *
 * The page keeps the database calls; everything that decides what is safe to
 * persist or display lives here so it can be unit-tested without Next.js,
 * Auth.js or a database.
 */

/** Stable V2 security-audit identifiers (see E3 shared contract §5). */
export const PASSWORD_CHANGE_AUDIT_ACTION = "V2_STAFF_PASSWORD_CHANGED";
export const PASSWORD_CHANGE_AUDIT_ENTITY_TYPE = "StaffUser";

/** Every password-change failure redirects to this one generic URL. */
export const PASSWORD_CHANGE_INVALID_REDIRECT = "/account/v2-password?invalid=1";

export type PasswordStateSnapshot = {
  active: boolean;
  mustChangePassword: boolean;
};

/**
 * Audit before/after snapshots contain only account state. Password hashes,
 * plaintext passwords and any other credential material must never be added
 * here (enforced by the page tests).
 */
export function buildPasswordChangeAuditSnapshots(staff: {
  active: boolean;
  mustChangePassword: boolean;
}): { beforeSnapshot: PasswordStateSnapshot; afterSnapshot: PasswordStateSnapshot } {
  return {
    beforeSnapshot: {
      active: staff.active,
      mustChangePassword: staff.mustChangePassword,
    },
    afterSnapshot: {
      active: staff.active,
      mustChangePassword: false,
    },
  };
}

export type PasswordAuditTenantMember = {
  tenantId: string;
  active: boolean;
};

export type PasswordAuditStoreMember = {
  storeId: string;
  active: boolean;
  store: { tenantId: string };
};

export type PasswordChangeAuditScope = {
  tenantId: string;
  storeId: string | null;
};

/**
 * Resolve the tenant/store an `AuditEvent` must be written under.
 *
 * Bootstrap sessions do not carry `defaultTenantId`/`currentTenantId` (they are
 * null in the JWT), so the page reads the persisted memberships and this helper
 * picks the same tenant/store the authorization path would pick: the first
 * active store membership (store id order) backed by an active tenant
 * membership. When only a tenant membership exists the event is still written
 * with a null store. When no active membership exists the caller skips the
 * audit instead of inventing a tenant.
 */
export function resolvePasswordChangeAuditScope(input: {
  tenantMembers: readonly PasswordAuditTenantMember[];
  storeMembers: readonly PasswordAuditStoreMember[];
}): PasswordChangeAuditScope | null {
  const activeTenants = [...input.tenantMembers]
    .filter((member) => member.active)
    .sort((left, right) => left.tenantId.localeCompare(right.tenantId));
  if (activeTenants.length === 0) return null;

  const activeTenantIds = new Set(activeTenants.map((member) => member.tenantId));
  const stores = [...input.storeMembers]
    .filter((member) => member.active && activeTenantIds.has(member.store.tenantId))
    .sort((left, right) => left.storeId.localeCompare(right.storeId));

  const store = stores[0];
  if (store) {
    return { tenantId: store.store.tenantId, storeId: store.storeId };
  }
  return { tenantId: activeTenants[0].tenantId, storeId: null };
}
