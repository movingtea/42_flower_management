import assert from "node:assert/strict";
import {
  V2_CAPABILITIES,
  V2_CAPABILITY_DENIED_MESSAGE,
  V2_NAV_GROUPS,
  V2_ROLES,
  V2_ROLE_CAPABILITIES,
  assertV2AnyCapability,
  assertV2Capability,
  canAccessV2NavItem,
  capabilitiesForRoles,
  getAllV2NavItems,
  getVisibleV2NavGroups,
  isV2NavItemActive,
  normalizeV2Roles,
  rolesHaveAnyCapability,
  rolesHaveCapability,
  type V2Role,
} from "./navigation";

const EXPECTED_CAPABILITIES: Record<V2Role, readonly string[]> = {
  ADMIN: [
    "read",
    "catalog",
    "purchase",
    "order",
    "production",
    "delivery",
    "staff",
  ],
  MANAGER: ["read", "catalog", "purchase", "order", "production", "delivery"],
  BUYER: ["read", "purchase"],
  SALES: ["read", "order", "delivery"],
  FLORIST: ["read", "production"],
};

const EXPECTED_VISIBLE_HREFS: Record<V2Role, string[]> = {
  ADMIN: [
    "/v2",
    "/v2/materials",
    "/v2/inventory",
    "/v2/operations",
    "/v2/purchase-orders",
    "/v2/suppliers",
    "/v2/catalog",
    "/v2/recipes",
    "/v2/packaging-kits",
    "/v2/orders",
    "/v2/staff",
  ],
  MANAGER: ["/v2", "/v2/materials", "/v2/inventory", "/v2/operations", "/v2/purchase-orders", "/v2/suppliers", "/v2/catalog", "/v2/recipes", "/v2/packaging-kits", "/v2/orders"],
  BUYER: ["/v2", "/v2/inventory", "/v2/operations", "/v2/purchase-orders", "/v2/suppliers"],
  SALES: ["/v2", "/v2/orders"],
  FLORIST: ["/v2", "/v2/orders"],
};

function visibleHrefs(roles: readonly string[]): string[] {
  return getVisibleV2NavGroups(roles).flatMap((group) =>
    group.items.map((item) => item.href)
  );
}

function main() {
  assert.deepEqual([...V2_CAPABILITIES], [
    "read",
    "catalog",
    "purchase",
    "order",
    "production",
    "delivery",
    "staff",
  ]);

  for (const role of V2_ROLES) {
    assert.deepEqual(
      [...V2_ROLE_CAPABILITIES[role]],
      EXPECTED_CAPABILITIES[role],
      `${role} capability matrix`
    );
    assert.deepEqual(
      capabilitiesForRoles([role]),
      EXPECTED_CAPABILITIES[role],
      `${role} derived capabilities`
    );
    assert.deepEqual(
      visibleHrefs([role]),
      EXPECTED_VISIBLE_HREFS[role],
      `${role} visible navigation`
    );
    assert.equal(
      rolesHaveCapability([role], "read"),
      true,
      `${role} can read the V2 shell`
    );
  }

  // Staff administration is ADMIN-only in both the matrix and navigation.
  for (const role of V2_ROLES) {
    assert.equal(
      rolesHaveCapability([role], "staff"),
      role === "ADMIN",
      `${role} staff capability`
    );
    assert.equal(
      visibleHrefs([role]).includes("/v2/staff"),
      role === "ADMIN",
      `${role} staff navigation`
    );
  }

  // Unknown or differently-cased role values never grant capabilities.
  assert.deepEqual(normalizeV2Roles(["admin", "SUPERUSER", " ADMIN "]), ["ADMIN"]);
  assert.deepEqual(normalizeV2Roles(["SALES", "ADMIN", "ADMIN"]), [
    "ADMIN",
    "SALES",
  ]);
  assert.deepEqual(capabilitiesForRoles(["admin"]), []);
  assert.deepEqual(capabilitiesForRoles(["SUPERUSER"]), []);
  assert.deepEqual(visibleHrefs(["SUPERUSER"]), []);
  assert.equal(rolesHaveCapability(["admin"], "read"), false);

  // Multiple roles combine without duplicating capabilities.
  assert.deepEqual(capabilitiesForRoles(["BUYER", "FLORIST"]), [
    "read",
    "purchase",
    "production",
  ]);
  assert.deepEqual(capabilitiesForRoles(["ADMIN", "MANAGER"]), [
    ...V2_CAPABILITIES,
  ]);

  assert.throws(
    () => assertV2Capability(["MANAGER"], "staff"),
    /没有此操作权限/
  );
  assert.doesNotThrow(() => assertV2Capability(["ADMIN"], "staff"));

  // Any-of guards use the same canonical matrix as single-capability guards.
  const orderModuleCapabilities = ["order", "production", "delivery"] as const;
  assert.equal(
    rolesHaveAnyCapability(["SALES"], orderModuleCapabilities),
    true
  );
  assert.equal(
    rolesHaveAnyCapability(["FLORIST"], orderModuleCapabilities),
    true
  );
  assert.equal(
    rolesHaveAnyCapability(["BUYER"], orderModuleCapabilities),
    false
  );
  assert.equal(
    rolesHaveAnyCapability(["SUPERUSER"], orderModuleCapabilities),
    false
  );
  assert.equal(rolesHaveAnyCapability([], orderModuleCapabilities), false);
  assert.equal(rolesHaveAnyCapability(["SALES"], []), false);
  assert.equal(rolesHaveAnyCapability(["BUYER"], ["purchase"]), true);
  assert.equal(rolesHaveAnyCapability(["SALES"], ["purchase"]), false);
  assert.equal(rolesHaveAnyCapability(["FLORIST"], ["catalog"]), false);

  assert.doesNotThrow(() =>
    assertV2AnyCapability(["SALES"], orderModuleCapabilities)
  );
  assert.doesNotThrow(() =>
    assertV2AnyCapability(["FLORIST"], orderModuleCapabilities)
  );
  assert.throws(
    () => assertV2AnyCapability(["BUYER"], orderModuleCapabilities),
    new RegExp(V2_CAPABILITY_DENIED_MESSAGE)
  );
  assert.throws(
    () => assertV2AnyCapability(["SUPERUSER"], orderModuleCapabilities),
    new RegExp(V2_CAPABILITY_DENIED_MESSAGE)
  );
  assert.throws(
    () => assertV2AnyCapability(["ADMIN"], []),
    new RegExp(V2_CAPABILITY_DENIED_MESSAGE)
  );

  // Navigation items are unique, well-formed and every item is reachable by at
  // least one canonical role.
  const items = getAllV2NavItems();
  assert.equal(new Set(items.map((item) => item.href)).size, items.length);
  for (const item of items) {
    assert.ok(item.anyCapabilities.length > 0, `${item.href} has a gate`);
    for (const capability of item.anyCapabilities) {
      assert.ok(V2_CAPABILITIES.includes(capability), `${item.href} capability`);
    }
    assert.equal(
      V2_ROLES.some((role) => canAccessV2NavItem([role], item)),
      true,
      `${item.href} is reachable by a role`
    );
  }
  assert.equal(V2_NAV_GROUPS.length, 5);

  assert.equal(isV2NavItemActive("/v2", items[0]), true);
  assert.equal(isV2NavItemActive("/v2/staff", items[0]), false);
  const staffItem = items.find((item) => item.href === "/v2/staff");
  assert.ok(staffItem);
  assert.equal(isV2NavItemActive("/v2/staff", staffItem), true);
  assert.equal(isV2NavItemActive("/v2/staff/history", staffItem), true);
  const ordersItem = items.find((item) => item.href === "/v2/orders");
  assert.ok(ordersItem);
  assert.equal(isV2NavItemActive("/v2/orders/new", ordersItem), true);
  assert.equal(isV2NavItemActive("/v2/order-status", ordersItem), false);

  console.log("v2 navigation/capability matrix tests passed");
}

main();
