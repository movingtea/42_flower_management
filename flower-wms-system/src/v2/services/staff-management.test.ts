import assert from "node:assert/strict";
import { config } from "dotenv";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma-v2/client";
import { authenticateV2Staff, resolveV2Access } from "../auth";
import {
  createStaffAccount,
  listStaffForManagement,
  normalizeStaffUsername,
  parseStaffRoles,
  resetStaffPassword,
  setStaffActive,
  updateStaffRoles,
  validateStaffDisplayName,
  validateStaffPassword,
  validateStaffUsername,
  type StaffManagementScope,
} from "./staff-management";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

function assertNoPasswordHash(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.equal(
    serialized.toLowerCase().includes("passwordhash"),
    false,
    "result/audit must not contain password hashes"
  );
}

function assertNoSecrets(value: unknown, secrets: readonly string[]): void {
  assertNoPasswordHash(value);
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    assert.equal(
      serialized.includes(secret),
      false,
      "result/audit must not contain a plaintext password"
    );
  }
}

function pureTests(): void {
  assert.equal(normalizeStaffUsername("  Admin.One  "), "admin.one");
  assert.equal(normalizeStaffUsername("ＡＤＭＩＮ"), "admin");
  assert.equal(validateStaffUsername("  Staff.One  "), "staff.one");
  assert.throws(() => validateStaffUsername("ab"), /用户名需为/);
  assert.throws(() => validateStaffUsername("bad name"), /用户名需为/);
  assert.throws(() => validateStaffUsername("bad/name"), /用户名需为/);
  assert.throws(() => validateStaffUsername("x".repeat(33)), /用户名需为/);

  assert.equal(validateStaffDisplayName("  测试员工  "), "测试员工");
  assert.throws(() => validateStaffDisplayName("   "), /显示名/);
  assert.throws(
    () => validateStaffDisplayName("x".repeat(51)),
    /显示名/
  );

  assert.equal(validateStaffPassword("StaffPass123!"), "StaffPass123!");
  assert.throws(() => validateStaffPassword("short"), /密码长度/);
  assert.throws(() => validateStaffPassword(" pass1234"), /密码长度/);
  assert.throws(() => validateStaffPassword("pass1234 "), /密码长度/);
  assert.throws(
    () => validateStaffPassword("x".repeat(73)),
    /密码长度/
  );
  assert.equal(validateStaffPassword("密".repeat(24)), "密".repeat(24));
  assert.throws(
    () => validateStaffPassword("密".repeat(25)),
    /密码长度/
  );

  assert.deepEqual(parseStaffRoles(["SALES", "BUYER", "BUYER"]), [
    "BUYER",
    "SALES",
  ]);
  assert.deepEqual(parseStaffRoles([" FLORIST "]), ["FLORIST"]);
  assert.throws(() => parseStaffRoles([]), /至少选择一个/);
  assert.throws(() => parseStaffRoles(["  "]), /至少选择一个/);
  assert.throws(() => parseStaffRoles(["OWNER"]), /员工角色无效/);
  assert.throws(() => parseStaffRoles(["admin"]), /员工角色无效/);
}

async function main() {
  pureTests();

  const connectionString =
    process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("staff management DB tests skipped: no V2 database URL");
    console.log("staff management pure tests passed");
    return;
  }

  const requireDb = process.env.V2_STAFF_REQUIRE_DB === "1";
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  const tenantIds: string[] = [];
  const storeIds: string[] = [];
  const staffIds: string[] = [];
  let dbAvailable = true;
  try {
    try {
      await db.$queryRaw`SELECT 1`;
    } catch (error) {
      dbAvailable = false;
      if (requireDb) throw error;
      console.log(
        `staff management DB tests skipped: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (!dbAvailable) {
      console.log("staff management pure tests passed");
      return;
    }

    const marker = crypto.randomUUID().slice(0, 8);
    const bootstrapPassword = "BootstrapPass123!";
    const staffPassword = "StaffPass123!";
    const managerPassword = "ManagerPass123!";
    const otherPassword = "OtherPass123!";
    const secondAdminPassword = "SecondAdminPass123!";
    const newPassword = "NewStaffPass456!";

    const tenantA = await db.tenant.create({
      data: {
        slug: `v2-staff-test-${marker}-a`,
        name: "V2 员工管理测试租户 A",
      },
    });
    tenantIds.push(tenantA.id);
    const storeA = await db.store.create({
      data: { tenantId: tenantA.id, code: "MAIN", name: "测试门店 A" },
    });
    storeIds.push(storeA.id);

    const tenantB = await db.tenant.create({
      data: {
        slug: `v2-staff-test-${marker}-b`,
        name: "V2 员工管理测试租户 B",
      },
    });
    tenantIds.push(tenantB.id);
    const storeB = await db.store.create({
      data: { tenantId: tenantB.id, code: "MAIN", name: "测试门店 B" },
    });
    storeIds.push(storeB.id);

    async function createBootstrapAdmin(
      tenantId: string,
      storeId: string,
      label: string
    ): Promise<string> {
      const passwordHash = await bcrypt.hash(bootstrapPassword, 12);
      const staff = await db.staffUser.create({
        data: {
          username: `${label}.${marker}`,
          passwordHash,
          displayName: `${label} 管理员`,
          active: true,
        },
      });
      staffIds.push(staff.id);
      await db.tenantMember.create({
        data: {
          tenantId,
          staffUserId: staff.id,
          roles: ["ADMIN"],
          active: true,
        },
      });
      await db.storeMember.create({
        data: {
          storeId,
          staffUserId: staff.id,
          roles: ["ADMIN"],
          active: true,
        },
      });
      return staff.id;
    }

    const adminAId = await createBootstrapAdmin(
      tenantA.id,
      storeA.id,
      "admin-a"
    );
    const adminBId = await createBootstrapAdmin(
      tenantB.id,
      storeB.id,
      "admin-b"
    );

    let scopeA: StaffManagementScope = {
      tenantId: tenantA.id,
      storeId: storeA.id,
      actorStaffId: adminAId,
    };
    const scopeB: StaffManagementScope = {
      tenantId: tenantB.id,
      storeId: storeB.id,
      actorStaffId: adminBId,
    };

    async function createAs(
      scope: StaffManagementScope,
      input: {
        username: string;
        password: string;
        displayName: string;
        roles: string[];
      }
    ) {
      const result = await db.$transaction((tx) =>
        createStaffAccount(tx, { ...scope, ...input })
      );
      staffIds.push(result.staffId);
      return result;
    }

    // The list is scoped to the current tenant/store and marks the actor.
    const initialRows = await listStaffForManagement(db, scopeA);
    assert.deepEqual(
      initialRows.map((row) => row.id),
      [adminAId]
    );
    assert.equal(initialRows[0].isSelf, true);
    assertNoPasswordHash(initialRows);

    // A non-admin cannot list or call any staff mutation service.
    const manager = await createAs(scopeA, {
      username: `manager.${marker}`,
      password: managerPassword,
      displayName: "测试经理",
      roles: ["MANAGER"],
    });
    const nonAdminScope: StaffManagementScope = {
      ...scopeA,
      actorStaffId: manager.staffId,
    };
    await assert.rejects(
      () => listStaffForManagement(db, nonAdminScope),
      /员工管理权限/
    );
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          createStaffAccount(tx, {
            ...nonAdminScope,
            username: `forbidden.${marker}`,
            password: staffPassword,
            displayName: "越权创建",
            roles: ["BUYER"],
          })
        ),
      /员工管理权限/
    );
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          resetStaffPassword(tx, {
            ...nonAdminScope,
            targetStaffId: adminAId,
            password: newPassword,
          })
        ),
      /员工管理权限/
    );
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          setStaffActive(tx, {
            ...nonAdminScope,
            targetStaffId: adminAId,
            active: false,
          })
        ),
      /员工管理权限/
    );
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          updateStaffRoles(tx, {
            ...nonAdminScope,
            targetStaffId: adminAId,
            roles: ["MANAGER"],
          })
        ),
      /员工管理权限/
    );

    // Create normalizes the username, hashes the password and writes both memberships.
    const created = await createAs(scopeA, {
      username: `  Staff.${marker}  `,
      password: staffPassword,
      displayName: "  测试员工  ",
      roles: ["BUYER"],
    });
    assert.equal(created.username, `staff.${marker}`);
    assert.deepEqual(created.roles, ["BUYER"]);
    assert.equal(created.active, true);
    assertNoSecrets(created, [staffPassword]);

    const createdRecord = await db.staffUser.findUniqueOrThrow({
      where: { id: created.staffId },
      include: { tenantMembers: true, storeMembers: true },
    });
    assert.equal(createdRecord.username, `staff.${marker}`);
    assert.equal(createdRecord.displayName, "测试员工");
    assert.notEqual(createdRecord.passwordHash, staffPassword);
    assert.equal(
      await bcrypt.compare(staffPassword, createdRecord.passwordHash),
      true
    );
    assert.equal(createdRecord.active, true);
    assert.equal(createdRecord.tenantMembers.length, 1);
    assert.equal(createdRecord.tenantMembers[0].tenantId, tenantA.id);
    assert.equal(createdRecord.tenantMembers[0].active, true);
    assert.deepEqual(createdRecord.tenantMembers[0].roles, ["BUYER"]);
    assert.equal(createdRecord.storeMembers.length, 1);
    assert.equal(createdRecord.storeMembers[0].storeId, storeA.id);
    assert.equal(createdRecord.storeMembers[0].active, true);
    assert.deepEqual(createdRecord.storeMembers[0].roles, ["BUYER"]);

    const createAudit = await db.auditEvent.findFirst({
      where: {
        tenantId: tenantA.id,
        entityId: created.staffId,
        action: "V2_STAFF_CREATED",
      },
    });
    assert.ok(createAudit);
    assert.equal(createAudit.actorStaffId, adminAId);
    assert.equal(createAudit.entityType, "StaffUser");
    assert.equal(createAudit.beforeSnapshot, null);
    assert.equal(
      (createAudit.afterSnapshot as { username?: string }).username,
      `staff.${marker}`
    );
    assertNoSecrets(createAudit, [staffPassword]);

    // Password secrecy: no hash/password in the returned service data.
    assert.equal("passwordHash" in created, false);
    assert.equal(JSON.stringify(created).includes(staffPassword), false);

    // The newly created account can authenticate and receives only its role capabilities.
    const loginRecord = await db.staffUser.findUniqueOrThrow({
      where: { username: created.username },
      include: {
        tenantMembers: true,
        storeMembers: { include: { store: true } },
      },
    });
    const principal = await authenticateV2Staff(
      { username: created.username, password: staffPassword },
      async () => loginRecord
    );
    assert.ok(principal);
    assert.equal(principal.sessionRole, "STORE_OPERATOR");
    assert.deepEqual(resolveV2Access("v2", loginRecord, "purchase"), {
      staffId: created.staffId,
      tenantId: tenantA.id,
      storeId: storeA.id,
    });
    assert.throws(
      () => resolveV2Access("v2", loginRecord, "staff"),
      /没有此操作权限/
    );

    // Duplicate usernames are rejected case-insensitively after normalization.
    await assert.rejects(
      () =>
        createAs(scopeA, {
          username: ` STAFF.${marker} `,
          password: staffPassword,
          displayName: "重复员工",
          roles: ["BUYER"],
        }),
      /用户名已被使用/
    );

    // Reset password keeps the account/memberships untouched and audits safely.
    const resetResult = await db.$transaction((tx) =>
      resetStaffPassword(tx, {
        ...scopeA,
        targetStaffId: created.staffId,
        password: newPassword,
      })
    );
    assert.deepEqual(resetResult, {
      staffId: created.staffId,
      username: created.username,
    });
    assertNoSecrets(resetResult, [staffPassword, newPassword]);

    const afterReset = await db.staffUser.findUniqueOrThrow({
      where: { id: created.staffId },
      include: {
        tenantMembers: true,
        storeMembers: { include: { store: true } },
      },
    });
    assert.notEqual(afterReset.passwordHash, createdRecord.passwordHash);
    assert.equal(
      await bcrypt.compare(newPassword, afterReset.passwordHash),
      true
    );
    assert.equal(
      await bcrypt.compare(staffPassword, afterReset.passwordHash),
      false
    );
    assert.equal(
      await authenticateV2Staff(
        { username: created.username, password: staffPassword },
        async () => afterReset
      ),
      null
    );
    assert.ok(
      await authenticateV2Staff(
        { username: created.username, password: newPassword },
        async () => afterReset
      )
    );
    const resetAudit = await db.auditEvent.findFirst({
      where: {
        tenantId: tenantA.id,
        entityId: created.staffId,
        action: "V2_STAFF_PASSWORD_RESET",
      },
    });
    assert.ok(resetAudit);
    assertNoSecrets(resetAudit, [staffPassword, newPassword]);
    assert.deepEqual(
      (resetAudit.beforeSnapshot as { tenantMember?: { roles?: string[] } })
        .tenantMember?.roles,
      ["BUYER"]
    );

    // Role updates are allowlisted, normalized and applied to both memberships.
    const rolesResult = await db.$transaction((tx) =>
      updateStaffRoles(tx, {
        ...scopeA,
        targetStaffId: created.staffId,
        roles: ["SALES", "BUYER"],
      })
    );
    assert.deepEqual(rolesResult.roles, ["BUYER", "SALES"]);
    const afterRoles = await db.staffUser.findUniqueOrThrow({
      where: { id: created.staffId },
      include: { tenantMembers: true, storeMembers: true },
    });
    assert.deepEqual(afterRoles.tenantMembers[0].roles, ["BUYER", "SALES"]);
    assert.deepEqual(afterRoles.storeMembers[0].roles, ["BUYER", "SALES"]);
    assert.deepEqual(
      resolveV2Access(
        "v2",
        {
          ...afterRoles,
          storeMembers: afterRoles.storeMembers.map((member) => ({
            ...member,
            store: { tenantId: tenantA.id },
          })),
        },
        "order"
      ),
      {
        staffId: created.staffId,
        tenantId: tenantA.id,
        storeId: storeA.id,
      }
    );
    const rolesAudit = await db.auditEvent.findFirst({
      where: {
        tenantId: tenantA.id,
        entityId: created.staffId,
        action: "V2_STAFF_ROLES_UPDATED",
      },
    });
    assert.ok(rolesAudit);
    assert.deepEqual(
      (rolesAudit.beforeSnapshot as { storeMember?: { roles?: string[] } })
        .storeMember?.roles,
      ["BUYER"]
    );
    assert.deepEqual(
      (rolesAudit.afterSnapshot as { storeMember?: { roles?: string[] } })
        .storeMember?.roles,
      ["BUYER", "SALES"]
    );
    assertNoSecrets(rolesAudit, [staffPassword, newPassword]);

    // Self protections are checked before any write.
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          setStaffActive(tx, {
            ...scopeA,
            targetStaffId: adminAId,
            active: false,
          })
        ),
      /当前登录账号/
    );
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          updateStaffRoles(tx, {
            ...scopeA,
            targetStaffId: adminAId,
            roles: ["MANAGER"],
          })
        ),
      /管理员角色/
    );
    const adminAfterSelfAttempts = await db.staffUser.findUniqueOrThrow({
      where: { id: adminAId },
      include: { tenantMembers: true, storeMembers: true },
    });
    assert.equal(adminAfterSelfAttempts.active, true);
    assert.deepEqual(adminAfterSelfAttempts.tenantMembers[0].roles, ["ADMIN"]);
    assert.deepEqual(adminAfterSelfAttempts.storeMembers[0].roles, ["ADMIN"]);

    // Inactive staff / tenant membership / store membership all fail login and revalidation.
    const inactiveUser = await createAs(scopeA, {
      username: `inactive.${marker}`,
      password: staffPassword,
      displayName: "停用员工",
      roles: ["BUYER"],
    });
    const deactivated = await db.$transaction((tx) =>
      setStaffActive(tx, {
        ...scopeA,
        targetStaffId: inactiveUser.staffId,
        active: false,
      })
    );
    assert.equal(deactivated.active, false);
    const inactiveRecord = await db.staffUser.findUniqueOrThrow({
      where: { id: inactiveUser.staffId },
      include: {
        tenantMembers: true,
        storeMembers: { include: { store: true } },
      },
    });
    assert.equal(
      await authenticateV2Staff(
        { username: inactiveRecord.username, password: staffPassword },
        async () => inactiveRecord
      ),
      null
    );
    assert.throws(
      () => resolveV2Access("v2", inactiveRecord),
      /访问权限/
    );

    const reactivated = await db.$transaction((tx) =>
      setStaffActive(tx, {
        ...scopeA,
        targetStaffId: inactiveUser.staffId,
        active: true,
      })
    );
    assert.equal(reactivated.active, true);
    const reactivatedRecord = await db.staffUser.findUniqueOrThrow({
      where: { id: inactiveUser.staffId },
      include: {
        tenantMembers: true,
        storeMembers: { include: { store: true } },
      },
    });
    assert.ok(
      await authenticateV2Staff(
        { username: reactivatedRecord.username, password: staffPassword },
        async () => reactivatedRecord
      )
    );

    await db.tenantMember.update({
      where: {
        tenantId_staffUserId: {
          tenantId: tenantA.id,
          staffUserId: inactiveUser.staffId,
        },
      },
      data: { active: false },
    });
    const tenantInactiveRecord = await db.staffUser.findUniqueOrThrow({
      where: { id: inactiveUser.staffId },
      include: {
        tenantMembers: true,
        storeMembers: { include: { store: true } },
      },
    });
    assert.equal(
      await authenticateV2Staff(
        { username: tenantInactiveRecord.username, password: staffPassword },
        async () => tenantInactiveRecord
      ),
      null
    );
    assert.throws(
      () => resolveV2Access("v2", tenantInactiveRecord),
      /门店访问权限/
    );

    await db.tenantMember.update({
      where: {
        tenantId_staffUserId: {
          tenantId: tenantA.id,
          staffUserId: inactiveUser.staffId,
        },
      },
      data: { active: true },
    });
    await db.storeMember.update({
      where: {
        storeId_staffUserId: {
          storeId: storeA.id,
          staffUserId: inactiveUser.staffId,
        },
      },
      data: { active: false },
    });
    const storeInactiveRecord = await db.staffUser.findUniqueOrThrow({
      where: { id: inactiveUser.staffId },
      include: {
        tenantMembers: true,
        storeMembers: { include: { store: true } },
      },
    });
    assert.equal(
      await authenticateV2Staff(
        { username: storeInactiveRecord.username, password: staffPassword },
        async () => storeInactiveRecord
      ),
      null
    );
    assert.throws(
      () => resolveV2Access("v2", storeInactiveRecord),
      /门店访问权限/
    );

    // Cross-tenant / cross-store records cannot be viewed or mutated.
    const targetB = await createAs(scopeB, {
      username: `other.${marker}`,
      password: otherPassword,
      displayName: "跨租户员工",
      roles: ["SALES"],
    });
    const listA = await listStaffForManagement(db, scopeA);
    assert.equal(
      listA.some((row) => row.id === targetB.staffId),
      false
    );
    const listB = await listStaffForManagement(db, scopeB);
    assert.equal(
      listB.some((row) => row.id === created.staffId),
      false
    );
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          resetStaffPassword(tx, {
            ...scopeA,
            targetStaffId: targetB.staffId,
            password: newPassword,
          })
        ),
      /不属于当前门店/
    );
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          setStaffActive(tx, {
            ...scopeA,
            targetStaffId: targetB.staffId,
            active: false,
          })
        ),
      /不属于当前门店/
    );
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          updateStaffRoles(tx, {
            ...scopeA,
            targetStaffId: targetB.staffId,
            roles: ["ADMIN"],
          })
        ),
      /不属于当前门店/
    );
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          setStaffActive(tx, {
            ...scopeB,
            targetStaffId: created.staffId,
            active: false,
          })
        ),
      /不属于当前门店/
    );
    const targetBAfter = await db.staffUser.findUniqueOrThrow({
      where: { id: targetB.staffId },
      include: { tenantMembers: true, storeMembers: true },
    });
    assert.equal(targetBAfter.active, true);
    assert.deepEqual(targetBAfter.tenantMembers[0].roles, ["SALES"]);
    assert.deepEqual(targetBAfter.storeMembers[0].roles, ["SALES"]);

    // Concurrent cross-deactivation is serialized by the tenant lock: at most
    // one admin update succeeds and the store always retains an active ADMIN.
    const secondAdmin = await createAs(scopeA, {
      username: `admin-c.${marker}`,
      password: secondAdminPassword,
      displayName: "第二管理员",
      roles: ["ADMIN"],
    });
    const concurrentResults = await Promise.allSettled([
      db.$transaction((tx) =>
        setStaffActive(tx, {
          ...scopeA,
          targetStaffId: secondAdmin.staffId,
          active: false,
        })
      ),
      db.$transaction((tx) =>
        setStaffActive(tx, {
          ...scopeA,
          actorStaffId: secondAdmin.staffId,
          targetStaffId: adminAId,
          active: false,
        })
      ),
    ]);
    assert.equal(
      concurrentResults.filter((result) => result.status === "fulfilled").length,
      1
    );
    assert.equal(
      concurrentResults.filter((result) => result.status === "rejected").length,
      1
    );

    const activeAdminMembers = await db.storeMember.findMany({
      where: {
        storeId: storeA.id,
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
                tenantId: tenantA.id,
                active: true,
                roles: { has: "ADMIN" },
              },
              select: { id: true },
            },
          },
        },
      },
    });
    const remainingAdmin = activeAdminMembers.find(
      (member) => member.staffUser.tenantMembers.length > 0
    );
    assert.ok(remainingAdmin, "an active ADMIN must remain in the store");
    scopeA = {
      ...scopeA,
      actorStaffId: remainingAdmin.staffUserId,
    };

    // Audit records carry actor, target, action and safe before/after membership state.
    const auditEvents = await db.auditEvent.findMany({
      where: { tenantId: tenantA.id },
      orderBy: { occurredAt: "asc" },
    });
    const actions = auditEvents.map((event) => event.action);
    assert.ok(actions.includes("V2_STAFF_CREATED"));
    assert.ok(actions.includes("V2_STAFF_PASSWORD_RESET"));
    assert.ok(actions.includes("V2_STAFF_ROLES_UPDATED"));
    assert.ok(actions.includes("V2_STAFF_DEACTIVATED"));
    assert.ok(actions.includes("V2_STAFF_ACTIVATED"));
    for (const event of auditEvents) {
      assert.equal(event.entityType, "StaffUser");
      assert.ok(event.actorStaffId);
      assert.ok(event.entityId);
      assertNoSecrets(event, [staffPassword, newPassword, otherPassword]);
    }

    console.log("staff management pure and DB tests passed");
  } finally {
    // Remove only records created by this test (never seeded business data).
    try {
      if (tenantIds.length > 0) {
        await db.auditEvent.deleteMany({
          where: { tenantId: { in: tenantIds } },
        });
      }
      if (storeIds.length > 0) {
        await db.storeMember.deleteMany({
          where: { storeId: { in: storeIds } },
        });
      }
      if (tenantIds.length > 0) {
        await db.tenantMember.deleteMany({
          where: { tenantId: { in: tenantIds } },
        });
      }
      if (staffIds.length > 0) {
        await db.staffUser.deleteMany({ where: { id: { in: staffIds } } });
      }
      if (storeIds.length > 0) {
        await db.store.deleteMany({ where: { id: { in: storeIds } } });
      }
      if (tenantIds.length > 0) {
        await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      }
    } catch (cleanupError) {
      console.error("staff management test cleanup failed", cleanupError);
      throw cleanupError;
    } finally {
      await db.$disconnect();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
