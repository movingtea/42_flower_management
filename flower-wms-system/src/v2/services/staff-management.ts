import bcrypt from "bcryptjs";
import { Prisma } from "../../generated/prisma-v2-draft/client";
import {
  V2_ROLES,
  isV2Role,
  normalizeV2Roles,
  rolesHaveCapability,
  type V2Role,
} from "../navigation";

/** Documented password policy for V2 staff accounts. */
export const V2_STAFF_PASSWORD_MIN_LENGTH = 8;
export const V2_STAFF_PASSWORD_MAX_LENGTH = 72;
export const V2_STAFF_USERNAME_MIN_LENGTH = 3;
export const V2_STAFF_USERNAME_MAX_LENGTH = 32;
export const V2_STAFF_DISPLAY_NAME_MAX_LENGTH = 50;

const BCRYPT_ROUNDS = 12;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export type StaffManagementScope = {
  tenantId: string;
  storeId: string;
  /** Always taken from the authenticated V2 session, never from form fields. */
  actorStaffId: string;
};

export type CreateStaffAccountInput = StaffManagementScope & {
  username: string;
  password: string;
  displayName: string;
  roles: readonly string[];
};

export type ResetStaffPasswordInput = StaffManagementScope & {
  targetStaffId: string;
  password: string;
};

export type SetStaffActiveInput = StaffManagementScope & {
  targetStaffId: string;
  active: boolean;
};

export type UpdateStaffRolesInput = StaffManagementScope & {
  targetStaffId: string;
  roles: readonly string[];
};

export type StaffManagementRow = {
  id: string;
  username: string;
  displayName: string | null;
  active: boolean;
  isSelf: boolean;
  tenantMembership: {
    roles: V2Role[];
    active: boolean;
  };
  storeMembership: {
    roles: V2Role[];
    active: boolean;
  };
};

export type StaffMutationResult = {
  staffId: string;
  username: string;
  active: boolean;
  roles: V2Role[];
};

export type StaffPasswordResetResult = {
  staffId: string;
  username: string;
};

type SafeMembershipSnapshot = {
  staffId: string;
  username: string;
  displayName: string | null;
  active: boolean;
  tenantMember: { roles: V2Role[]; active: boolean } | null;
  storeMember: { roles: V2Role[]; active: boolean } | null;
};

/** Normalize usernames so duplicate checks are case-insensitive. */
export function normalizeStaffUsername(raw: string): string {
  const value = typeof raw === "string" ? raw : "";
  return value.normalize("NFKC").trim().toLowerCase();
}

export function validateStaffUsername(raw: string): string {
  const username = normalizeStaffUsername(raw);
  if (
    username.length < V2_STAFF_USERNAME_MIN_LENGTH ||
    username.length > V2_STAFF_USERNAME_MAX_LENGTH ||
    !USERNAME_PATTERN.test(username)
  ) {
    throw new Error(
      `用户名需为 ${V2_STAFF_USERNAME_MIN_LENGTH}-${V2_STAFF_USERNAME_MAX_LENGTH} 位小写字母、数字、点、下划线或短横线`
    );
  }
  return username;
}

export function validateStaffDisplayName(raw: string): string {
  const displayName = typeof raw === "string" ? raw.trim() : "";
  if (
    displayName.length === 0 ||
    displayName.length > V2_STAFF_DISPLAY_NAME_MAX_LENGTH
  ) {
    throw new Error(
      `请填写 1-${V2_STAFF_DISPLAY_NAME_MAX_LENGTH} 个字符的显示名`
    );
  }
  return displayName;
}

/**
 * Passwords must be at least 8 characters and at most 72 UTF-8 bytes (the
 * bcrypt input limit), and must not start or end with whitespace. The raw value
 * is hashed with bcrypt; it is never trimmed or persisted.
 */
export function validateStaffPassword(raw: string): string {
  const password = typeof raw === "string" ? raw : "";
  if (
    password.length < V2_STAFF_PASSWORD_MIN_LENGTH ||
    Buffer.byteLength(password, "utf8") > V2_STAFF_PASSWORD_MAX_LENGTH ||
    password.trim() !== password
  ) {
    throw new Error(
      `密码长度需为至少 ${V2_STAFF_PASSWORD_MIN_LENGTH} 位且不超过 ${V2_STAFF_PASSWORD_MAX_LENGTH} 字节，且首尾不能包含空格`
    );
  }
  return password;
}

/** Strict allowlist for role assignment; unknown or empty selections are rejected. */
export function parseStaffRoles(values: readonly string[]): V2Role[] {
  const candidates = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (candidates.length === 0) throw new Error("请至少选择一个员工角色");
  if (candidates.some((value) => !isV2Role(value))) {
    throw new Error("员工角色无效");
  }

  const selected = new Set<V2Role>(candidates as V2Role[]);
  return V2_ROLES.filter((role) => selected.has(role));
}

function normalizeScope(scope: StaffManagementScope): StaffManagementScope {
  const tenantId = typeof scope.tenantId === "string" ? scope.tenantId.trim() : "";
  const storeId = typeof scope.storeId === "string" ? scope.storeId.trim() : "";
  const actorStaffId =
    typeof scope.actorStaffId === "string" ? scope.actorStaffId.trim() : "";
  if (!tenantId || !storeId || !actorStaffId) {
    throw new Error("缺少租户、门店或操作员工信息");
  }
  return { tenantId, storeId, actorStaffId };
}

function normalizeTargetId(raw: string): string {
  const targetId = typeof raw === "string" ? raw.trim() : "";
  if (!targetId) throw new Error("员工不存在或不属于当前门店");
  return targetId;
}

/**
 * Serialize staff mutations for one tenant. Every mutation locks the same row
 * first, so concurrent self-deactivation / last-admin checks observe committed
 * membership state rather than a stale pre-lock snapshot.
 */
async function lockTenant(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE
  `;
  if (rows.length === 0) throw new Error("租户不存在");
}

async function assertCurrentScope(
  tx: Prisma.TransactionClient,
  scope: StaffManagementScope
): Promise<void> {
  const store = await tx.store.findUnique({
    where: { id: scope.storeId },
    select: { tenantId: true },
  });
  if (!store || store.tenantId !== scope.tenantId) {
    throw new Error("门店不属于当前租户");
  }
}

async function assertStaffAdmin(
  tx: Prisma.TransactionClient,
  scope: StaffManagementScope
): Promise<void> {
  const actor = await tx.staffUser.findUnique({
    where: { id: scope.actorStaffId },
    select: {
      id: true,
      active: true,
      tenantMembers: {
        where: { tenantId: scope.tenantId },
        select: { roles: true, active: true },
      },
      storeMembers: {
        where: { storeId: scope.storeId },
        select: { roles: true, active: true },
      },
    },
  });

  const tenantMember = actor?.tenantMembers[0];
  const storeMember = actor?.storeMembers[0];
  if (
    !actor?.active ||
    !tenantMember?.active ||
    !storeMember?.active ||
    !rolesHaveCapability(tenantMember.roles, "staff") ||
    !rolesHaveCapability(storeMember.roles, "staff")
  ) {
    throw new Error("当前账号无员工管理权限");
  }
}

type ScopedTarget = {
  target: {
    id: string;
    username: string;
    displayName: string | null;
    active: boolean;
  };
  tenantMember: {
    id: string;
    roles: string[];
    active: boolean;
  };
  storeMember: {
    id: string;
    roles: string[];
    active: boolean;
  };
};

async function loadScopedTarget(
  tx: Prisma.TransactionClient,
  scope: StaffManagementScope,
  targetStaffId: string
): Promise<ScopedTarget> {
  const targetId = normalizeTargetId(targetStaffId);
  const target = await tx.staffUser.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      username: true,
      displayName: true,
      active: true,
      tenantMembers: {
        where: { tenantId: scope.tenantId },
        select: { id: true, roles: true, active: true },
      },
      storeMembers: {
        where: { storeId: scope.storeId },
        select: {
          id: true,
          roles: true,
          active: true,
          store: { select: { tenantId: true } },
        },
      },
    },
  });

  const tenantMember = target?.tenantMembers[0];
  const storeMember = target?.storeMembers[0];
  if (
    !target ||
    !tenantMember ||
    !storeMember ||
    storeMember.store.tenantId !== scope.tenantId
  ) {
    throw new Error("员工不存在或不属于当前门店");
  }

  return {
    target: {
      id: target.id,
      username: target.username,
      displayName: target.displayName,
      active: target.active,
    },
    tenantMember: {
      id: tenantMember.id,
      roles: tenantMember.roles,
      active: tenantMember.active,
    },
    storeMember: {
      id: storeMember.id,
      roles: storeMember.roles,
      active: storeMember.active,
    },
  };
}

function isActiveAdmin(target: ScopedTarget): boolean {
  return (
    target.target.active &&
    target.tenantMember.active &&
    target.storeMember.active &&
    rolesHaveCapability(target.tenantMember.roles, "staff") &&
    rolesHaveCapability(target.storeMember.roles, "staff")
  );
}

function snapshot(target: ScopedTarget): SafeMembershipSnapshot {
  return {
    staffId: target.target.id,
    username: target.target.username,
    displayName: target.target.displayName,
    active: target.target.active,
    tenantMember: {
      roles: normalizeV2Roles(target.tenantMember.roles),
      active: target.tenantMember.active,
    },
    storeMember: {
      roles: normalizeV2Roles(target.storeMember.roles),
      active: target.storeMember.active,
    },
  };
}

function snapshotValues(input: {
  staffId: string;
  username: string;
  displayName: string | null;
  active: boolean;
  tenantActive: boolean;
  storeActive: boolean;
  tenantRoles: V2Role[];
  storeRoles: V2Role[];
}): SafeMembershipSnapshot {
  return {
    staffId: input.staffId,
    username: input.username,
    displayName: input.displayName,
    active: input.active,
    tenantMember: {
      roles: [...input.tenantRoles],
      active: input.tenantActive,
    },
    storeMember: {
      roles: [...input.storeRoles],
      active: input.storeActive,
    },
  };
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  scope: StaffManagementScope,
  targetId: string,
  action: string,
  before: SafeMembershipSnapshot | null,
  after: SafeMembershipSnapshot | null
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action,
      entityType: "StaffUser",
      entityId: targetId,
      beforeSnapshot: before ?? Prisma.DbNull,
      afterSnapshot: after ?? Prisma.DbNull,
    },
  });
}

async function countActiveAdmins(
  tx: Prisma.TransactionClient,
  scope: StaffManagementScope
): Promise<number> {
  const storeAdmins = await tx.storeMember.findMany({
    where: {
      storeId: scope.storeId,
      store: { tenantId: scope.tenantId },
      active: true,
      roles: { has: "ADMIN" },
      staffUser: { active: true },
    },
    select: {
      staffUserId: true,
      staffUser: {
        select: {
          tenantMembers: {
            where: {
              tenantId: scope.tenantId,
              active: true,
              roles: { has: "ADMIN" },
            },
            select: { id: true },
          },
        },
      },
    },
  });

  return storeAdmins.filter(
    (member) => member.staffUser.tenantMembers.length > 0
  ).length;
}

/**
 * List only staff that have both a tenant membership and a store membership in
 * the current scope. The return value never contains password/hash fields.
 */
export async function listStaffForManagement(
  db: Prisma.TransactionClient,
  rawScope: StaffManagementScope
): Promise<StaffManagementRow[]> {
  const scope = normalizeScope(rawScope);
  await assertCurrentScope(db, scope);
  await assertStaffAdmin(db, scope);

  const storeMembers = await db.storeMember.findMany({
    where: { storeId: scope.storeId },
    select: {
      staffUserId: true,
      roles: true,
      active: true,
      staffUser: {
        select: {
          id: true,
          username: true,
          displayName: true,
          active: true,
        },
      },
    },
  });
  const tenantMembers = await db.tenantMember.findMany({
    where: {
      tenantId: scope.tenantId,
      staffUserId: { in: storeMembers.map((member) => member.staffUserId) },
    },
    select: { staffUserId: true, roles: true, active: true },
  });
  const tenantByStaff = new Map(
    tenantMembers.map((member) => [member.staffUserId, member])
  );

  return storeMembers
    .flatMap((storeMember) => {
      const tenantMember = tenantByStaff.get(storeMember.staffUserId);
      if (!tenantMember) return [];
      return [
        {
          id: storeMember.staffUser.id,
          username: storeMember.staffUser.username,
          displayName: storeMember.staffUser.displayName,
          active: storeMember.staffUser.active,
          isSelf: storeMember.staffUser.id === scope.actorStaffId,
          tenantMembership: {
            roles: normalizeV2Roles(tenantMember.roles),
            active: tenantMember.active,
          },
          storeMembership: {
            roles: normalizeV2Roles(storeMember.roles),
            active: storeMember.active,
          },
        } satisfies StaffManagementRow,
      ];
    })
    .sort((left, right) => left.username.localeCompare(right.username));
}

export async function createStaffAccount(
  tx: Prisma.TransactionClient,
  input: CreateStaffAccountInput
): Promise<StaffMutationResult> {
  const scope = normalizeScope(input);
  const username = validateStaffUsername(input.username);
  const displayName = validateStaffDisplayName(input.displayName);
  const roles = parseStaffRoles(input.roles);
  const password = validateStaffPassword(input.password);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await lockTenant(tx, scope.tenantId);
  await assertCurrentScope(tx, scope);
  await assertStaffAdmin(tx, scope);

  const existing = await tx.staffUser.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw new Error("用户名已被使用");

  try {
    const staff = await tx.staffUser.create({
      data: {
        username,
        passwordHash,
        displayName,
        active: true,
      },
      select: { id: true, username: true, active: true },
    });
    await tx.tenantMember.create({
      data: {
        tenantId: scope.tenantId,
        staffUserId: staff.id,
        roles,
        active: true,
      },
    });
    await tx.storeMember.create({
      data: {
        storeId: scope.storeId,
        staffUserId: staff.id,
        roles,
        active: true,
      },
    });

    await writeAudit(
      tx,
      scope,
      staff.id,
      "V2_STAFF_CREATED",
      null,
      snapshotValues({
        staffId: staff.id,
        username: staff.username,
        displayName,
        active: staff.active,
        tenantActive: true,
        storeActive: true,
        tenantRoles: roles,
        storeRoles: roles,
      })
    );

    return {
      staffId: staff.id,
      username: staff.username,
      active: staff.active,
      roles,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("用户名已被使用");
    }
    throw error;
  }
}

export async function resetStaffPassword(
  tx: Prisma.TransactionClient,
  input: ResetStaffPasswordInput
): Promise<StaffPasswordResetResult> {
  const scope = normalizeScope(input);
  const password = validateStaffPassword(input.password);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await lockTenant(tx, scope.tenantId);
  await assertCurrentScope(tx, scope);
  await assertStaffAdmin(tx, scope);
  const target = await loadScopedTarget(tx, scope, input.targetStaffId);
  const before = snapshot(target);

  await tx.staffUser.update({
    where: { id: target.target.id },
    data: { passwordHash },
  });

  await writeAudit(
    tx,
    scope,
    target.target.id,
    "V2_STAFF_PASSWORD_RESET",
    before,
    before
  );

  return { staffId: target.target.id, username: target.target.username };
}

export async function setStaffActive(
  tx: Prisma.TransactionClient,
  input: SetStaffActiveInput
): Promise<StaffMutationResult> {
  const scope = normalizeScope(input);
  if (typeof input.active !== "boolean") {
    throw new Error("员工启用状态无效");
  }

  await lockTenant(tx, scope.tenantId);
  await assertCurrentScope(tx, scope);
  await assertStaffAdmin(tx, scope);
  const target = await loadScopedTarget(tx, scope, input.targetStaffId);
  const before = snapshot(target);

  if (!input.active && target.target.id === scope.actorStaffId) {
    throw new Error("不能停用当前登录账号");
  }

  if (!input.active && isActiveAdmin(target)) {
    const admins = await countActiveAdmins(tx, scope);
    if (admins <= 1) {
      throw new Error("当前门店至少需要保留一名启用状态的管理员");
    }
  }

  await tx.staffUser.update({
    where: { id: target.target.id },
    data: { active: input.active },
  });
  await tx.tenantMember.update({
    where: { id: target.tenantMember.id },
    data: { active: input.active },
  });
  await tx.storeMember.update({
    where: { id: target.storeMember.id },
    data: { active: input.active },
  });

  const after = snapshotValues({
    staffId: target.target.id,
    username: target.target.username,
    displayName: target.target.displayName,
    active: input.active,
    tenantActive: input.active,
    storeActive: input.active,
    tenantRoles: normalizeV2Roles(target.tenantMember.roles),
    storeRoles: normalizeV2Roles(target.storeMember.roles),
  });
  await writeAudit(
    tx,
    scope,
    target.target.id,
    input.active ? "V2_STAFF_ACTIVATED" : "V2_STAFF_DEACTIVATED",
    before,
    after
  );

  return {
    staffId: target.target.id,
    username: target.target.username,
    active: input.active,
    roles: normalizeV2Roles(target.tenantMember.roles),
  };
}

export async function updateStaffRoles(
  tx: Prisma.TransactionClient,
  input: UpdateStaffRolesInput
): Promise<StaffMutationResult> {
  const scope = normalizeScope(input);
  const roles = parseStaffRoles(input.roles);

  await lockTenant(tx, scope.tenantId);
  await assertCurrentScope(tx, scope);
  await assertStaffAdmin(tx, scope);
  const target = await loadScopedTarget(tx, scope, input.targetStaffId);
  const before = snapshot(target);

  if (
    target.target.id === scope.actorStaffId &&
    !roles.includes("ADMIN")
  ) {
    throw new Error("不能移除当前登录账号的管理员角色");
  }

  if (isActiveAdmin(target) && !roles.includes("ADMIN")) {
    const admins = await countActiveAdmins(tx, scope);
    if (admins <= 1) {
      throw new Error("当前门店至少需要保留一名启用状态的管理员");
    }
  }

  await tx.tenantMember.update({
    where: { id: target.tenantMember.id },
    data: { roles },
  });
  await tx.storeMember.update({
    where: { id: target.storeMember.id },
    data: { roles },
  });

  const after = snapshotValues({
    staffId: target.target.id,
    username: target.target.username,
    displayName: target.target.displayName,
    active: target.target.active,
    tenantActive: target.tenantMember.active,
    storeActive: target.storeMember.active,
    tenantRoles: roles,
    storeRoles: roles,
  });
  await writeAudit(
    tx,
    scope,
    target.target.id,
    "V2_STAFF_ROLES_UPDATED",
    before,
    after
  );

  return {
    staffId: target.target.id,
    username: target.target.username,
    active: target.target.active,
    roles,
  };
}
