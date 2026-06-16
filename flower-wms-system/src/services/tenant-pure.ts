import type { Role } from "@/generated/prisma/enums";

/** 默认租户 slug（Sprint 21 单店地基） */
export const DEFAULT_TENANT_SLUG = "universe42";

/** 默认租户显示名称 */
export const DEFAULT_TENANT_NAME = "Universe42 / 万物肆贰";

export type TenantMembershipContext = {
  defaultTenantId: string | null;
  currentTenantId: string | null;
  tenantRole: Role | null;
};

/**
 * 从活跃成员列表推导 session 租户上下文。
 * 单成员时 currentTenantId = defaultTenantId；多成员时优先 isDefault。
 */
export function resolveTenantMembershipContext(
  memberships: ReadonlyArray<{
    tenantId: string;
    role: Role;
    isDefault: boolean;
    status: string;
  }>
): TenantMembershipContext {
  const active = memberships.filter((m) => m.status === "ACTIVE");
  if (active.length === 0) {
    return {
      defaultTenantId: null,
      currentTenantId: null,
      tenantRole: null,
    };
  }

  const defaultMember =
    active.find((m) => m.isDefault) ?? (active.length === 1 ? active[0] : null);

  if (!defaultMember) {
    return {
      defaultTenantId: null,
      currentTenantId: null,
      tenantRole: null,
    };
  }

  return {
    defaultTenantId: defaultMember.tenantId,
    currentTenantId: defaultMember.tenantId,
    tenantRole: defaultMember.role,
  };
}

/** 是否应将成员标记为默认（仅一个 membership 时必为 true） */
export function shouldMarkMembershipAsDefault(activeMembershipCount: number): boolean {
  return activeMembershipCount <= 1;
}
