import { expect, test } from "@playwright/test";
import { openRoleContext } from "./helpers/auth";
import { gotoApp } from "./helpers/ui";
import { dbQuery } from "./helpers/db";

/**
 * E11-AUTH-01 browser evidence: the navigation matrix follows the capability
 * table, and capability-gated module URLs are rejected on the server (the
 * server guard throws before any module data is rendered or written).
 */
type RoleFixture = {
  role: "admin" | "manager" | "buyer" | "sales" | "florist";
  visible: string[];
  hidden: string[];
};

const ROLES: readonly RoleFixture[] = [
  {
    role: "admin",
    visible: ["花材母表", "耗材母表", "采购单", "订单履约", "员工与权限"],
    hidden: [],
  },
  {
    role: "manager",
    visible: ["花材母表", "耗材母表", "采购单", "仓储日常", "订单履约"],
    hidden: ["员工与权限"],
  },
  {
    role: "buyer",
    visible: ["采购单", "供应商", "仓储日常", "库存管理"],
    hidden: ["花材母表", "耗材母表", "商品与 SKU", "标准配方", "包装方案", "订单履约"],
  },
  {
    role: "sales",
    visible: ["订单履约"],
    hidden: ["花材母表", "耗材母表", "采购单", "仓储日常", "商品与 SKU"],
  },
  {
    role: "florist",
    visible: ["订单履约"],
    hidden: ["花材母表", "耗材母表", "采购单", "仓储日常", "商品与 SKU", "标准配方"],
  },
];

test.describe("独立用例 · 角色与门店权限（E11-AUTH-01）", () => {
  test.setTimeout(300_000);

  for (const fixture of ROLES) {
    test(`${fixture.role} 的 V2 导航符合能力表`, async ({ browser }) => {
      const { context, page } = await openRoleContext(browser, fixture.role);
      try {
        await gotoApp(page, "/v2");
        const nav = page.locator("aside nav");
        for (const label of fixture.visible) {
          await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
        }
        for (const label of fixture.hidden) {
          await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
        }
      } finally {
        await context.close();
      }
    });
  }

  test("缺少能力的模块 URL 被服务端拒绝且不产生写入", async ({ browser }) => {
    const countRows = async () => {
      const rows = await dbQuery<{ materials: string; orders: string; purchases: string }>(
        `SELECT (SELECT COUNT(*)::text FROM "Material") AS materials,
                (SELECT COUNT(*)::text FROM "Order") AS orders,
                (SELECT COUNT(*)::text FROM "PurchaseOrder") AS purchases`,
      );
      const row = rows[0];
      if (!row) throw new Error("count query returned no row");
      return row;
    };

    const before = await countRows();
    const denials: { role: "buyer" | "sales" | "florist"; path: string; heading: string }[] = [
      { role: "buyer", path: "/v2/orders", heading: "订单看板" },
      { role: "sales", path: "/v2/purchase-orders", heading: "采购单管理" },
      { role: "florist", path: "/v2/materials", heading: "花材母表" },
      { role: "florist", path: "/v2/consumables", heading: "耗材母表" },
    ];

    for (const denial of denials) {
      const { context, page } = await openRoleContext(browser, denial.role);
      try {
        const response = await page.goto(denial.path);
        // The server-side capability guard throws before the page renders: the
        // request is rejected and the module screen never appears.
        expect(response?.status() ?? 0).toBeGreaterThanOrEqual(400);
        await expect(page.getByRole("heading", { name: denial.heading })).toHaveCount(0);
      } finally {
        await context.close();
      }
    }

    const after = await countRows();
    expect(after).toEqual(before);
  });
});
