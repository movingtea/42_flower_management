import {
  DEFAULT_TENANT_SLUG,
  resolveTenantMembershipContext,
  shouldMarkMembershipAsDefault,
} from "./tenant-pure";
import { Role } from "@/generated/prisma/enums";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

// shouldMarkMembershipAsDefault
assert(shouldMarkMembershipAsDefault(0) === true, "0 memberships");
assert(shouldMarkMembershipAsDefault(1) === true, "1 membership");
assert(shouldMarkMembershipAsDefault(2) === false, "2 memberships");

// resolveTenantMembershipContext — empty
const empty = resolveTenantMembershipContext([]);
assert(empty.currentTenantId === null, "empty memberships");

// single active membership
const single = resolveTenantMembershipContext([
  {
    tenantId: "tenant-1",
    role: Role.STORE_ADMIN,
    isDefault: true,
    status: "ACTIVE",
  },
]);
assert(single.defaultTenantId === "tenant-1", "defaultTenantId");
assert(single.currentTenantId === "tenant-1", "currentTenantId");
assert(single.tenantRole === Role.STORE_ADMIN, "tenantRole");

// single without isDefault flag still resolves when only one
const singleNoFlag = resolveTenantMembershipContext([
  {
    tenantId: "tenant-1",
    role: Role.FLORIST,
    isDefault: false,
    status: "ACTIVE",
  },
]);
assert(singleNoFlag.currentTenantId === "tenant-1", "single member fallback");

// disabled memberships ignored
const disabledOnly = resolveTenantMembershipContext([
  {
    tenantId: "tenant-1",
    role: Role.FLORIST,
    isDefault: true,
    status: "DISABLED",
  },
]);
assert(disabledOnly.currentTenantId === null, "disabled ignored");

assert(DEFAULT_TENANT_SLUG === "universe42", "default slug constant");

console.log("[test:tenant-foundation] all pure checks passed");
