/**
 * Sprint 22 — 验证核心业务表 tenantId 无 NULL 行。
 * Run: npm run db:verify:tenant
 */
import "dotenv/config";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "../src/lib/prisma";

type VerifyTarget = {
  label: string;
  table: string;
  countNull: (client: PrismaClient) => Promise<number>;
};

const TARGETS: VerifyTarget[] = [
  {
    label: "ProductSpu",
    table: "product_spus",
    countNull: (c) => c.productSpu.count({ where: { tenantId: null } }),
  },
  {
    label: "ProductSku",
    table: "product_skus",
    countNull: (c) => c.productSku.count({ where: { tenantId: null } }),
  },
  {
    label: "Order",
    table: "orders",
    countNull: (c) => c.order.count({ where: { tenantId: null } }),
  },
  {
    label: "Customer",
    table: "customers",
    countNull: (c) => c.customer.count({ where: { tenantId: null } }),
  },
  {
    label: "Supplier",
    table: "suppliers",
    countNull: (c) => c.supplier.count({ where: { tenantId: null } }),
  },
  {
    label: "Material",
    table: "materials",
    countNull: (c) => c.material.count({ where: { tenantId: null } }),
  },
  {
    label: "Batch",
    table: "batches",
    countNull: (c) => c.batch.count({ where: { tenantId: null } }),
  },
  {
    label: "StockLog",
    table: "stock_logs",
    countNull: (c) => c.stockLog.count({ where: { tenantId: null } }),
  },
  {
    label: "Recipe",
    table: "recipes",
    countNull: (c) => c.recipe.count({ where: { tenantId: null } }),
  },
  {
    label: "PurchaseOrder",
    table: "purchase_orders",
    countNull: (c) => c.purchaseOrder.count({ where: { tenantId: null } }),
  },
  {
    label: "Banner",
    table: "banners",
    countNull: (c) => c.banner.count({ where: { tenantId: null } }),
  },
  {
    label: "CmsRecommendationSlot",
    table: "cms_recommendation_slots",
    countNull: (c) =>
      c.cmsRecommendationSlot.count({ where: { tenantId: null } }),
  },
  {
    label: "CmsHomeSceneEntry",
    table: "cms_home_scene_entries",
    countNull: (c) =>
      c.cmsHomeSceneEntry.count({ where: { tenantId: null } }),
  },
];

async function main() {
  const failures: string[] = [];

  for (const target of TARGETS) {
    const nullCount = await target.countNull(prisma);
    if (nullCount === 0) {
      console.log(`[OK] ${target.label} (${target.table}): NULL tenantId = 0`);
    } else {
      failures.push(
        `${target.label} (${target.table}): NULL tenantId = ${nullCount}`
      );
    }
  }

  if (failures.length > 0) {
    console.error("❌ Tenant backfill verification failed");
    for (const line of failures) {
      console.error(`  - ${line}`);
    }
    process.exit(1);
  }

  console.log("Tenant backfill verification passed (all tables NULL = 0)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
