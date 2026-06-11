/**
 * 权限矩阵 smoke（纯函数，无需 DB）
 * Run: npm run smoke:permission-matrix
 */
import assert from "node:assert/strict";
import { Role } from "../src/generated/prisma/enums";
import { ADMIN_ERROR_CODES } from "../src/lib/business-errors";
import {
  canAccessBusinessData,
  canCmsWrite,
  canManageStaffUsers,
  canOperateOrders,
  canWmsWrite,
  hasPermission,
} from "../src/lib/rbac";

function main() {
  assert.equal(canAccessBusinessData(Role.IT_ADMIN), false);
  assert.equal(hasPermission(Role.IT_ADMIN, "business:read"), false);
  assert.equal(hasPermission(Role.IT_ADMIN, "wms:write"), false);

  assert.equal(canAccessBusinessData(Role.STORE_ADMIN), true);
  assert.equal(hasPermission(Role.STORE_ADMIN, "business:read"), true);
  assert.equal(canManageStaffUsers(Role.STORE_ADMIN), true);

  assert.equal(canWmsWrite(Role.WAREHOUSE_MANAGER), true);
  assert.equal(canCmsWrite(Role.WAREHOUSE_MANAGER), false);

  assert.equal(canOperateOrders(Role.FLORIST), true);
  assert.equal(canWmsWrite(Role.FLORIST), false);
  assert.equal(canManageStaffUsers(Role.FLORIST), false);

  assert.equal(ADMIN_ERROR_CODES.PERMISSION_DENIED, "PERMISSION_DENIED");

  console.log("smoke-permission-matrix passed");
}

main();
