import type { Prisma } from "@/generated/prisma/client";
import { Role, TenantMemberStatus, TenantStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_TENANT_NAME,
  DEFAULT_TENANT_SLUG,
  resolveTenantMembershipContext,
  shouldMarkMembershipAsDefault,
  type TenantMembershipContext,
} from "@/services/tenant-pure";

type DbClient = Prisma.TransactionClient | typeof prisma;

export type BackfillTenantMembersResult = {
  tenantSlug: string;
  staffUsersFound: number;
  membersCreated: number;
  membersSkipped: number;
  defaultFlagsUpdated: number;
};

export type EnsureTenantMemberResult = {
  created: boolean;
  membershipId: string;
  tenantId: string;
};

/** 确保默认租户 universe42 存在（幂等） */
export async function ensureDefaultTenant(client: DbClient = prisma) {
  return client.tenant.upsert({
    where: { slug: DEFAULT_TENANT_SLUG },
    create: {
      slug: DEFAULT_TENANT_SLUG,
      name: DEFAULT_TENANT_NAME,
      status: TenantStatus.ACTIVE,
      description: "系统默认单店租户（Sprint 21 地基）",
    },
    update: {
      name: DEFAULT_TENANT_NAME,
      status: TenantStatus.ACTIVE,
    },
  });
}

/** 按 slug 获取默认租户；不存在时抛出清晰错误 */
export async function getDefaultTenant(client: DbClient = prisma) {
  const tenant = await client.tenant.findUnique({
    where: { slug: DEFAULT_TENANT_SLUG },
  });
  if (!tenant) {
    throw new Error(
      `默认租户 "${DEFAULT_TENANT_SLUG}" 不存在，请先执行 npm run db:seed 或 npm run db:seed:tenant`
    );
  }
  return tenant;
}

/** 同步 StaffUser 的 isDefault 标记：仅一个活跃 membership 时设为 true */
export async function syncStaffUserDefaultMembership(
  staffUserId: string,
  client: DbClient = prisma
): Promise<number> {
  const memberships = await client.tenantMember.findMany({
    where: {
      staffUserId,
      status: TenantMemberStatus.ACTIVE,
    },
    orderBy: { joinedAt: "asc" },
  });

  if (memberships.length === 0) return 0;

  const markDefault = shouldMarkMembershipAsDefault(memberships.length);
  let updated = 0;

  if (markDefault) {
    const only = memberships[0];
    if (!only.isDefault) {
      await client.tenantMember.update({
        where: { id: only.id },
        data: { isDefault: true },
      });
      updated += 1;
    }
    return updated;
  }

  const hasDefault = memberships.some((m) => m.isDefault);
  if (!hasDefault && memberships[0]) {
    await client.tenantMember.update({
      where: { id: memberships[0].id },
      data: { isDefault: true },
    });
    updated += 1;
  }

  return updated;
}

/**
 * 确保 StaffUser 属于默认租户（幂等）。
 * TenantMember.role 复制 StaffUser.role；未来租户级权限基础，当前仍由 StaffUser.role 驱动。
 */
export async function ensureTenantMemberForStaffUser(
  staffUserId: string,
  role: Role,
  client: DbClient = prisma
): Promise<EnsureTenantMemberResult> {
  const tenant = await ensureDefaultTenant(client);

  const existing = await client.tenantMember.findUnique({
    where: {
      tenantId_staffUserId: {
        tenantId: tenant.id,
        staffUserId,
      },
    },
  });

  if (existing) {
    if (existing.role !== role || existing.status !== TenantMemberStatus.ACTIVE) {
      await client.tenantMember.update({
        where: { id: existing.id },
        data: {
          role,
          status: TenantMemberStatus.ACTIVE,
        },
      });
    }
    await syncStaffUserDefaultMembership(staffUserId, client);
    return {
      created: false,
      membershipId: existing.id,
      tenantId: tenant.id,
    };
  }

  const activeCount = await client.tenantMember.count({
    where: {
      staffUserId,
      status: TenantMemberStatus.ACTIVE,
    },
  });

  const created = await client.tenantMember.create({
    data: {
      tenantId: tenant.id,
      staffUserId,
      role,
      status: TenantMemberStatus.ACTIVE,
      isDefault: shouldMarkMembershipAsDefault(activeCount + 1),
    },
  });

  await syncStaffUserDefaultMembership(staffUserId, client);

  return {
    created: true,
    membershipId: created.id,
    tenantId: tenant.id,
  };
}

/** 为全部 StaffUser 回填默认租户成员关系（幂等） */
export async function backfillDefaultTenantMembers(
  client: DbClient = prisma
): Promise<BackfillTenantMembersResult> {
  const tenant = await ensureDefaultTenant(client);
  const staffUsers = await client.staffUser.findMany({
    select: { id: true, role: true },
    orderBy: { createdAt: "asc" },
  });

  let membersCreated = 0;
  let membersSkipped = 0;
  let defaultFlagsUpdated = 0;

  for (const staff of staffUsers) {
    const result = await ensureTenantMemberForStaffUser(
      staff.id,
      staff.role,
      client
    );
    if (result.created) {
      membersCreated += 1;
    } else {
      membersSkipped += 1;
    }
    defaultFlagsUpdated += await syncStaffUserDefaultMembership(staff.id, client);
  }

  return {
    tenantSlug: tenant.slug,
    staffUsersFound: staffUsers.length,
    membersCreated,
    membersSkipped,
    defaultFlagsUpdated,
  };
}

/** 登录时加载租户上下文；缺 membership 时自动补齐并打 warning */
export async function resolveStaffTenantContext(
  staffUserId: string,
  staffRole: Role
): Promise<TenantMembershipContext> {
  let memberships = await prisma.tenantMember.findMany({
    where: { staffUserId },
    select: {
      tenantId: true,
      role: true,
      isDefault: true,
      status: true,
    },
  });

  if (memberships.length === 0) {
    console.warn(
      `[tenant] StaffUser ${staffUserId} 缺少 TenantMember，登录时自动补齐默认租户`
    );
    await ensureTenantMemberForStaffUser(staffUserId, staffRole);
    memberships = await prisma.tenantMember.findMany({
      where: { staffUserId },
      select: {
        tenantId: true,
        role: true,
        isDefault: true,
        status: true,
      },
    });
  }

  return resolveTenantMembershipContext(memberships);
}

/**
 * 事务内创建 StaffUser 并加入默认租户。
 * 避免 StaffUser 创建成功但 TenantMember 失败的不一致状态。
 */
export async function createStaffUserWithDefaultTenantMembership(input: {
  username: string;
  passwordHash: string;
  role: Role;
  displayName: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const staffUser = await tx.staffUser.create({
      data: {
        username: input.username,
        passwordHash: input.passwordHash,
        role: input.role,
        displayName: input.displayName,
      },
    });

    await ensureTenantMemberForStaffUser(staffUser.id, staffUser.role, tx);

    return staffUser;
  });
}
