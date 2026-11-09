import bcrypt from "bcryptjs";
import type { Role } from "@/generated/prisma/enums";
import type { AuthSource } from "@/types/next-auth";
import {
  assertV2AnyCapability,
  assertV2Capability,
  capabilitiesForRoles,
  normalizeV2Roles,
  rolesHaveCapability,
  type V2Capability,
  type V2Role,
} from "./navigation";

export {
  V2_CAPABILITIES,
  V2_CAPABILITY_DENIED_MESSAGE,
  V2_NAV_GROUPS,
  V2_ROLES,
  V2_ROLE_CAPABILITIES,
  V2_ROLE_LABELS,
  assertV2AnyCapability,
  assertV2Capability,
  canAccessV2NavItem,
  capabilitiesForRoles,
  getAllV2NavItems,
  getVisibleV2NavGroups,
  isV2NavItemActive,
  isV2Role,
  normalizeV2Roles,
  rolesHaveAnyCapability,
  rolesHaveCapability,
} from "./navigation";
export type {
  V2Capability,
  V2NavGroup,
  V2NavItem,
  V2Role,
} from "./navigation";

export type V2TenantMembership = {
  tenantId: string;
  roles: string[];
  active: boolean;
};

export type V2StoreMembership = {
  storeId: string;
  roles: string[];
  active: boolean;
  store: { tenantId: string };
};

/** Minimal shape needed from v2 PostgreSQL StaffUser + memberships. */
export type V2StaffRecord = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string | null;
  active: boolean;
  mustChangePassword?: boolean;
  tenantMembers: V2TenantMembership[];
  storeMembers: V2StoreMembership[];
};

export type V2StaffPrincipal = {
  id: string;
  username: string;
  displayName: string | null;
  /** Legacy Role value carried by the shared Auth.js session for UI compatibility. */
  sessionRole: Role;
  source: Extract<AuthSource, "v2">;
  mustChangePassword?: boolean;
};

export type V2AccessContext = {
  staffId: string;
  username: string;
  displayName: string | null;
  tenantId: string;
  storeId: string;
  roles: V2Role[];
  capabilities: V2Capability[];
};

type ActiveMembership = {
  storeMember: V2StoreMembership;
  tenantMember: V2TenantMembership;
};

function findActiveMembership(staff: V2StaffRecord): ActiveMembership | null {
  // No store switcher exists yet. Pick a deterministic active store so the
  // layout, pages and service all resolve the same current store.
  const storeMembers = [...staff.storeMembers].sort((left, right) =>
    left.storeId.localeCompare(right.storeId)
  );
  for (const storeMember of storeMembers) {
    if (!storeMember.active) continue;
    const tenantMember = staff.tenantMembers.find(
      (member) => member.active && member.tenantId === storeMember.store.tenantId
    );
    if (tenantMember) return { storeMember, tenantMember };
  }
  return null;
}

/** Map v2 membership roles onto the existing session Role field for display compatibility only. */
export function mapV2RolesToSessionRole(roles: string[]): Role {
  const normalized = normalizeV2Roles(roles);
  if (normalized.includes("ADMIN")) return "STORE_ADMIN";
  if (normalized.includes("MANAGER")) return "WAREHOUSE_MANAGER";
  if (normalized.includes("FLORIST")) return "FLORIST";
  return "STORE_OPERATOR";
}

/**
 * Authenticate a v2 credential against a v2 StaffUser lookup only.
 * The repository callback is intentionally injected so the v2 provider cannot
 * accidentally fall back to the legacy StaffUser table.
 *
 * A credential is only accepted when the staff user is active and still has an
 * active store membership backed by an active tenant membership. An inactive
 * membership therefore fails at login, not merely after the session is created.
 */
export async function authenticateV2Staff(
  credentials: { username: string; password: string },
  findStaff: (username: string) => Promise<V2StaffRecord | null>,
  comparePassword: (password: string, hash: string) => Promise<boolean> = bcrypt.compare
): Promise<V2StaffPrincipal | null> {
  const username = credentials.username.trim();
  const password = credentials.password;
  if (!username || !password) return null;

  const staff = await findStaff(username);
  if (!staff?.active) return null;

  const passwordMatches = await comparePassword(password, staff.passwordHash);
  if (!passwordMatches) return null;

  const membership = findActiveMembership(staff);
  if (!membership) return null;

  const roles = normalizeV2Roles([
    ...membership.storeMember.roles,
    ...membership.tenantMember.roles,
  ]);
  if (!rolesHaveCapability(roles, "read")) return null;

  return {
    id: staff.id,
    username: staff.username,
    displayName: staff.displayName,
    sessionRole: mapV2RolesToSessionRole(roles),
    source: "v2",
    ...(staff.mustChangePassword ? { mustChangePassword: true } : {}),
  };
}

/**
 * Resolve the active v2 membership boundary without checking a capability.
 * This is the single place that turns persisted memberships into the current
 * tenant/store/role context used by navigation and staff administration.
 */
export function resolveV2Membership(
  source: AuthSource | undefined,
  staff: V2StaffRecord | null
): V2AccessContext {
  if (source !== "v2") throw new Error("请使用 v2 账号登录");
  if (!staff?.active) throw new Error("员工未获 v2 访问权限");
  if (staff.mustChangePassword) throw new V2PasswordChangeRequired();

  const membership = findActiveMembership(staff);
  if (!membership) throw new Error("员工未获门店访问权限");

  const roles = normalizeV2Roles([
    ...membership.storeMember.roles,
    ...membership.tenantMember.roles,
  ]);

  return {
    staffId: staff.id,
    username: staff.username,
    displayName: staff.displayName,
    tenantId: membership.storeMember.store.tenantId,
    storeId: membership.storeMember.storeId,
    roles,
    capabilities: capabilitiesForRoles(roles),
  };
}

export class V2PasswordChangeRequired extends Error {
  constructor() {
    super("请先修改初始密码");
  }
}

/**
 * Authorize a v2 session against any one of the supplied capabilities.
 * A session without the v2 source marker (including pre-marker legacy tokens)
 * is always rejected, even when a legacy Role is present.
 */
export function resolveV2AnyAccess(
  source: AuthSource | undefined,
  staff: V2StaffRecord | null,
  capabilities: readonly V2Capability[]
): { staffId: string; tenantId: string; storeId: string } {
  const context = resolveV2Membership(source, staff);
  assertV2AnyCapability(context.roles, capabilities);

  return {
    staffId: context.staffId,
    tenantId: context.tenantId,
    storeId: context.storeId,
  };
}

/**
 * Authorize a v2 session against one v2 staff capability.
 */
export function resolveV2Access(
  source: AuthSource | undefined,
  staff: V2StaffRecord | null,
  capability: V2Capability = "read"
): { staffId: string; tenantId: string; storeId: string } {
  return resolveV2AnyAccess(source, staff, [capability]);
}

async function loadV2Context(): Promise<V2AccessContext> {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session?.user?.id || session.user.source !== "v2") {
    throw new Error("请使用 v2 账号登录");
  }
  if (session.user.v2BootstrapSession) throw new V2PasswordChangeRequired();

  const { v2db } = await import("./db");
  const staff = await v2db.staffUser.findUnique({
    where: { id: session.user.id },
    include: {
      tenantMembers: true,
      storeMembers: { include: { store: true } },
    },
  });

  return resolveV2Membership(session.user.source, staff);
}

/**
 * Re-read the authenticated staff user and memberships on every server render
 * or action. The JWT is only an identity hint; active membership and capability
 * are always revalidated against the V2 database.
 */
export async function requireV2Context(
  capability: V2Capability = "read"
): Promise<V2AccessContext> {
  const context = await loadV2Context();
  assertV2Capability(context.roles, capability);
  return context;
}

/** Server guard for routes whose navigation item accepts any of several capabilities. */
export async function requireV2AnyContext(
  capabilities: readonly V2Capability[]
): Promise<V2AccessContext> {
  const context = await loadV2Context();
  assertV2AnyCapability(context.roles, capabilities);
  return context;
}

export async function requireV2Store(capability: V2Capability = "read") {
  const context = await requireV2Context(capability);
  return {
    staffId: context.staffId,
    tenantId: context.tenantId,
    storeId: context.storeId,
  };
}

export async function requireV2AnyStore(
  capabilities: readonly V2Capability[]
) {
  const context = await requireV2AnyContext(capabilities);
  return {
    staffId: context.staffId,
    tenantId: context.tenantId,
    storeId: context.storeId,
  };
}
