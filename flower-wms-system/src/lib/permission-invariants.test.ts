/**
 * Run: npm run test:permission-invariants
 */
import assert from "node:assert/strict";
import { Role } from "@/generated/prisma/enums";
import {
  canAccessBusinessData,
  canCmsWrite,
  canManageStaffUsers,
  canOperateOrders,
  canViewLossAudit,
  canWmsWrite,
  hasPermission,
} from "@/lib/rbac";

function testStoreAdminFullBusiness() {
  assert.equal(canAccessBusinessData(Role.STORE_ADMIN), true);
  assert.equal(hasPermission(Role.STORE_ADMIN, "business:read"), true);
  assert.equal(hasPermission(Role.STORE_ADMIN, "business:write"), true);
  assert.equal(canManageStaffUsers(Role.STORE_ADMIN), true);
}

function testWarehouseManagerBoundaries() {
  assert.equal(canWmsWrite(Role.WAREHOUSE_MANAGER), true);
  assert.equal(canCmsWrite(Role.WAREHOUSE_MANAGER), false);
  assert.equal(hasPermission(Role.WAREHOUSE_MANAGER, "cms:read"), false);
  assert.equal(canViewLossAudit(Role.WAREHOUSE_MANAGER), true);
}

function testFloristBoundaries() {
  assert.equal(canOperateOrders(Role.FLORIST), true);
  assert.equal(canWmsWrite(Role.FLORIST), false);
  assert.equal(hasPermission(Role.FLORIST, "business:write"), true);
  assert.equal(canManageStaffUsers(Role.FLORIST), false);
}

function testItAdminBlindSpot() {
  assert.equal(canAccessBusinessData(Role.IT_ADMIN), false);
  assert.equal(hasPermission(Role.IT_ADMIN, "business:read"), false);
  assert.equal(hasPermission(Role.IT_ADMIN, "business:write"), false);
  assert.equal(canManageStaffUsers(Role.IT_ADMIN), true);
  assert.equal(hasPermission(Role.IT_ADMIN, "staff:manage"), true);
}

function testApiNotWeakerThanBusinessRead() {
  for (const role of Object.values(Role)) {
    if (!canAccessBusinessData(role)) {
      assert.equal(hasPermission(role, "business:read"), false);
      assert.equal(hasPermission(role, "wms:write"), false);
    }
  }
}

function run() {
  testStoreAdminFullBusiness();
  testWarehouseManagerBoundaries();
  testFloristBoundaries();
  testItAdminBlindSpot();
  testApiNotWeakerThanBusinessRead();
  console.log("permission-invariants.test.ts: all tests passed");
}

run();
