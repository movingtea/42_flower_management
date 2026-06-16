/**
 * Sprint 21 — Tenant / TenantMember 地基 smoke（需 DATABASE_URL）。
 */
import "dotenv/config";

const SMOKE_USERNAME = "SMOKE_TEST_TENANT_FOUNDATION";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("[smoke:tenant-foundation] skip — DATABASE_URL not set");
    return;
  }

  const { Role } = await import("../src/generated/prisma/enums");
  const { prisma } = await import("../src/lib/prisma");
  const { DEFAULT_TENANT_SLUG, resolveTenantMembershipContext } = await import(
    "../src/services/tenant-pure"
  );
  const {
    backfillDefaultTenantMembers,
    createStaffUserWithDefaultTenantMembership,
    ensureDefaultTenant,
    ensureTenantMemberForStaffUser,
  } = await import("../src/services/tenant");

  async function cleanup() {
    const user = await prisma.staffUser.findUnique({
      where: { username: SMOKE_USERNAME },
      select: { id: true },
    });
    if (!user) return;
    await prisma.tenantMember.deleteMany({ where: { staffUserId: user.id } });
    await prisma.staffUser.delete({ where: { id: user.id } });
  }

  await cleanup();

  const tenant1 = await ensureDefaultTenant();
  const tenant2 = await ensureDefaultTenant();
  assert(tenant1.id === tenant2.id, "ensureDefaultTenant should be idempotent");
  assert(tenant1.slug === DEFAULT_TENANT_SLUG, "default tenant slug");

  const firstStaff = await prisma.staffUser.findFirstOrThrow({
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true },
  });

  const member1 = await ensureTenantMemberForStaffUser(
    firstStaff.id,
    firstStaff.role
  );
  const member2 = await ensureTenantMemberForStaffUser(
    firstStaff.id,
    firstStaff.role
  );
  assert(!member2.created, "duplicate membership should not be created");
  assert(member1.membershipId === member2.membershipId, "same membership id");

  const created = await createStaffUserWithDefaultTenantMembership({
    username: SMOKE_USERNAME,
    passwordHash: "not-used",
    role: Role.FLORIST,
    displayName: "Smoke Tenant",
  });

  const membership = await prisma.tenantMember.findFirst({
    where: { staffUserId: created.id },
    include: { tenant: true },
  });
  assert(!!membership, "StaffUser create should add TenantMember");
  assert(membership!.role === Role.FLORIST, "TenantMember.role copies StaffUser.role");
  assert(membership!.tenant.slug === DEFAULT_TENANT_SLUG, "default tenant slug on member");
  assert(membership!.isDefault === true, "single membership should be default");

  const ctx = resolveTenantMembershipContext([
    {
      tenantId: membership!.tenantId,
      role: membership!.role,
      isDefault: membership!.isDefault,
      status: membership!.status,
    },
  ]);
  assert(ctx.currentTenantId === membership!.tenantId, "session tenant context");
  assert(ctx.tenantRole === Role.FLORIST, "tenantRole in context");

  const backfill = await backfillDefaultTenantMembers();
  assert(backfill.staffUsersFound >= 1, "backfill finds staff users");

  await cleanup();

  console.log("[smoke:tenant-foundation] all checks passed");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
