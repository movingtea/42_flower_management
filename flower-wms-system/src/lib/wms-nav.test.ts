/**
 * 运行：npm run test:wms-nav
 */
import assert from "node:assert/strict";
import { Role } from "@/generated/prisma/enums";
import {
  canAccessNavItem,
  canAccessWmsPath,
  getVisibleNavGroups,
  isNavItemActive,
  WMS_NAV_GROUPS,
} from "@/lib/wms-nav";

function testStoreAdminSeesAllGroups() {
  const groups = getVisibleNavGroups(Role.STORE_ADMIN);
  assert.equal(groups.length, 5);
  const labels = groups.flatMap((g) => g.items.map((i) => i.label));
  assert.ok(labels.includes("仪表盘"));
  assert.ok(labels.includes("经营报表"));
  assert.ok(labels.includes("试运营准备"));
  assert.ok(labels.includes("订单履约"));
}

function testItAdminSeesNoGroups() {
  assert.equal(getVisibleNavGroups(Role.IT_ADMIN).length, 0);
  assert.equal(canAccessWmsPath(Role.IT_ADMIN, "/wms/dashboard"), false);
}

function testFloristOnlyOrders() {
  const groups = getVisibleNavGroups(Role.FLORIST);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "客户与订单");
  assert.deepEqual(
    groups[0].items.map((i) => i.href),
    ["/wms/orders"]
  );
  assert.equal(canAccessWmsPath(Role.FLORIST, "/wms/setup"), false);
  assert.equal(canAccessWmsPath(Role.FLORIST, "/wms/orders"), true);
}

function testWarehouseManagerInventoryGroup() {
  const groups = getVisibleNavGroups(Role.WAREHOUSE_MANAGER);
  const titles = groups.map((g) => g.title);
  assert.ok(titles.includes("库存与采购"));
  assert.ok(titles.includes("商品与成本"));
  const labels = groups.flatMap((g) => g.items.map((i) => i.label));
  assert.ok(labels.includes("采购单"));
  assert.ok(labels.includes("标准配方"));
}

function testActiveStates() {
  const inventory = WMS_NAV_GROUPS[2].items[0];
  assert.equal(isNavItemActive("/wms/inventory/abc", inventory), true);
  assert.equal(isNavItemActive("/wms/inventory", inventory), true);

  const dashboard = WMS_NAV_GROUPS[0].items[0];
  assert.equal(isNavItemActive("/wms/dashboard", dashboard), true);
  assert.equal(isNavItemActive("/wms/dashboard/extra", dashboard), false);

  const crm = WMS_NAV_GROUPS[4].items[1];
  assert.equal(isNavItemActive("/wms/crm/customers/1", crm), true);
  assert.equal(isNavItemActive("/wms/crm/reminders", crm), true);
}

function testEmptyGroupHidden() {
  const item = WMS_NAV_GROUPS[0].items[0];
  assert.equal(canAccessNavItem(Role.IT_ADMIN, item), false);
}

function run() {
  testStoreAdminSeesAllGroups();
  testItAdminSeesNoGroups();
  testFloristOnlyOrders();
  testWarehouseManagerInventoryGroup();
  testActiveStates();
  testEmptyGroupHidden();
  console.log("wms-nav.test.ts: all passed");
}

run();
