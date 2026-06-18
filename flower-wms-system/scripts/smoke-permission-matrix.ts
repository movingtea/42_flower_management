/**
 * 权限矩阵 smoke（纯函数 + 静态 route 审计，无需 DB）
 * Run: npm run smoke:permission-matrix
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Role } from "../src/generated/prisma/enums";
import { ADMIN_ERROR_CODES } from "../src/lib/business-errors";
import {
  ADMIN_ROUTE_PERMISSION_MATRIX,
  LOW_PRIVILEGE_WRITE_DENY,
} from "../src/lib/admin-api-permission-matrix";
import {
  canAccessBusinessData,
  canCmsWrite,
  canManageStaffUsers,
  canOperateOrders,
  canWmsWrite,
  hasPermission,
} from "../src/lib/rbac";
import { checkAdminApiPermissions } from "./check-admin-api-permissions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_API_ROOT = path.join(__dirname, "../src/app/api/admin");

function readRouteSource(relativeFile: string): string {
  const full = path.join(ADMIN_API_ROOT, relativeFile);
  assert.ok(fs.existsSync(full), `route file missing: ${relativeFile}`);
  return fs.readFileSync(full, "utf8");
}

function testBatchARoutesHaveRequirePermission() {
  const byFile = new Map<string, string>();
  for (const spec of ADMIN_ROUTE_PERMISSION_MATRIX) {
    if (!byFile.has(spec.file)) {
      byFile.set(spec.file, readRouteSource(spec.file));
    }
    const src = byFile.get(spec.file)!;
    assert.match(
      src,
      /requirePermission\s*\(/,
      `${spec.file} must call requirePermission (${spec.method})`
    );
    assert.match(
      src,
      new RegExp(`requirePermission\\(\\"${spec.permission}\\"\\)`),
      `${spec.file} should include requirePermission("${spec.permission}") for ${spec.method}`
    );
  }
}

function testRoleBoundaries() {
  assert.equal(canAccessBusinessData(Role.IT_ADMIN), false);
  assert.equal(hasPermission(Role.IT_ADMIN, "business:read"), false);
  assert.equal(hasPermission(Role.IT_ADMIN, "wms:write"), false);
  assert.equal(hasPermission(Role.IT_ADMIN, "cms:write"), false);
  assert.equal(hasPermission(Role.IT_ADMIN, "staff:manage"), true);

  assert.equal(canAccessBusinessData(Role.STORE_ADMIN), true);
  assert.equal(hasPermission(Role.STORE_ADMIN, "cms:write"), true);
  assert.equal(hasPermission(Role.STORE_ADMIN, "wms:write"), true);
  assert.equal(canManageStaffUsers(Role.STORE_ADMIN), true);

  assert.equal(canWmsWrite(Role.WAREHOUSE_MANAGER), true);
  assert.equal(canCmsWrite(Role.WAREHOUSE_MANAGER), false);
  assert.equal(hasPermission(Role.WAREHOUSE_MANAGER, "cms:read"), false);

  assert.equal(canOperateOrders(Role.FLORIST), true);
  assert.equal(canWmsWrite(Role.FLORIST), false);
  assert.equal(hasPermission(Role.FLORIST, "wms:read"), true);

  assert.equal(canCmsWrite(Role.STORE_OPERATOR), true);
  assert.equal(canWmsWrite(Role.STORE_OPERATOR), false);

  for (const { role, permission } of LOW_PRIVILEGE_WRITE_DENY) {
    assert.equal(
      hasPermission(Role[role], permission),
      false,
      `${role} must not have ${permission}`
    );
  }

  assert.equal(ADMIN_ERROR_CODES.PERMISSION_DENIED, "PERMISSION_DENIED");
}

function testStaticAdminApiGuard() {
  const { scanned, violations } = checkAdminApiPermissions();
  if (violations.length > 0) {
    const msg = violations
      .map((v) => `${v.file} [${v.methods.join(", ")}]`)
      .join("; ");
    assert.fail(`check-admin-api-permissions: ${msg}`);
  }
  assert.ok(scanned >= 80, `expected >= 80 admin route files, got ${scanned}`);
}

function main() {
  testBatchARoutesHaveRequirePermission();
  testRoleBoundaries();
  testStaticAdminApiGuard();
  console.log("smoke-permission-matrix passed");
}

main();
