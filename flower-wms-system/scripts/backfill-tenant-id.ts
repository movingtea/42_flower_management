/**
 * Sprint 22 — 为核心业务表回填 tenantId = "universe42"（幂等、分页）。
 * Run: npm run db:backfill:tenant
 */
import "dotenv/config";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "../src/lib/prisma";

const DEFAULT_TENANT = "universe42";
const BATCH_SIZE = 500;

type BackfillTarget = {
  label: string;
  countNull: (client: PrismaClient) => Promise<number>;
  backfillBatch: (client: PrismaClient, take: number) => Promise<number>;
};

const TARGETS: BackfillTarget[] = [
  {
    label: "ProductSpu",
    countNull: (c) => c.productSpu.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.productSpu.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.productSpu.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "ProductSku",
    countNull: (c) => c.productSku.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.productSku.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.productSku.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "Order",
    countNull: (c) => c.order.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.order.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.order.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "Customer",
    countNull: (c) => c.customer.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.customer.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.customer.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "Supplier",
    countNull: (c) => c.supplier.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.supplier.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.supplier.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "Material",
    countNull: (c) => c.material.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.material.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.material.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "Batch",
    countNull: (c) => c.batch.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.batch.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.batch.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "StockLog",
    countNull: (c) => c.stockLog.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.stockLog.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.stockLog.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "Recipe",
    countNull: (c) => c.recipe.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.recipe.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.recipe.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "PurchaseOrder",
    countNull: (c) => c.purchaseOrder.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.purchaseOrder.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.purchaseOrder.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "Banner",
    countNull: (c) => c.banner.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.banner.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.banner.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "CmsRecommendationSlot",
    countNull: (c) =>
      c.cmsRecommendationSlot.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.cmsRecommendationSlot.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.cmsRecommendationSlot.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
  {
    label: "CmsHomeSceneEntry",
    countNull: (c) =>
      c.cmsHomeSceneEntry.count({ where: { tenantId: null } }),
    backfillBatch: async (c, take) => {
      const rows = await c.cmsHomeSceneEntry.findMany({
        where: { tenantId: null },
        select: { id: true },
        take,
      });
      if (rows.length === 0) return 0;
      await c.cmsHomeSceneEntry.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { tenantId: DEFAULT_TENANT },
      });
      return rows.length;
    },
  },
];

async function backfillTable(target: BackfillTarget): Promise<number> {
  const before = await target.countNull(prisma);
  if (before === 0) {
    console.log(`[OK] ${target.label} backfilled: 0 rows`);
    return 0;
  }

  let total = 0;
  for (;;) {
    const updated = await target.backfillBatch(prisma, BATCH_SIZE);
    if (updated === 0) break;
    total += updated;
  }

  console.log(`[OK] ${target.label} backfilled: ${total} rows`);
  return total;
}

async function main() {
  console.log(`Backfilling tenantId = "${DEFAULT_TENANT}" (batch size ${BATCH_SIZE})`);

  let grandTotal = 0;
  for (const target of TARGETS) {
    grandTotal += await backfillTable(target);
  }

  console.log(`Done. Total rows updated: ${grandTotal}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
