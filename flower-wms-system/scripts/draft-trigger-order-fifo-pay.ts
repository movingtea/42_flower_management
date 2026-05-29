/**
 * 集成触发脚本 — 在真实库上试跑 markOrderPaidWithFifo（需 .env DATABASE_URL）
 *
 * 用法：
 *   npx tsx scripts/draft-trigger-order-fifo-pay.ts <orderId> [userId]
 *
 * 仅处理 status=PENDING_PAYMENT 的订单；失败时整笔事务回滚（含订单状态）。
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { OrderStatus } from "../src/generated/prisma/enums";
import {
  markOrderPaidWithFifo,
  PhysicalStockInsufficientError,
} from "../src/services/order-fifo";

async function main() {
  const orderId = process.argv[2];
  const userId = process.argv[3];

  if (!orderId) {
    console.error(
      "用法: npx tsx scripts/draft-trigger-order-fifo-pay.ts <orderId> [userId]"
    );
    process.exit(1);
  }

  const before = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          sku: {
            include: {
              spu: {
                include: {
                  recipe: { include: { lines: { include: { wiki: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!before) {
    console.error("订单不存在:", orderId);
    process.exit(1);
  }

  console.log("--- 支付前快照 ---");
  console.log("orderNo:", before.orderNo);
  console.log("status:", before.status);
  for (const item of before.items) {
    const recipe = item.sku.spu.recipe;
    console.log(
      `  item ${item.id}: skuQty=${item.quantity} spu=${item.snapshotProductName} recipeId=${recipe?.id ?? "无"}`
    );
    recipe?.lines.forEach((line) => {
      console.log(
        `    - ${line.wiki.chineseName} x${line.quantityNeeded * item.quantity} (wiki=${line.flowerWikiId})`
      );
    });
  }

  if (before.status !== OrderStatus.PENDING_PAYMENT) {
    console.error("仅支持 PENDING_PAYMENT 订单，当前:", before.status);
    process.exit(1);
  }

  try {
    const order = await markOrderPaidWithFifo({
      orderId,
      userId,
      operator: "draft-script",
    });

    const logs = await prisma.stockLog.findMany({
      where: { orderId, type: "SALE_OUT" },
      include: { batch: { select: { batchNo: true, remainingQty: true } } },
      orderBy: { createdAt: "asc" },
    });

    console.log("\n--- 支付成功 ---");
    console.log("status:", order.status);
    console.log("paidAt:", order.paidAt?.toISOString());
    console.log("SALE_OUT 流水条数:", logs.length);
    for (const log of logs) {
      console.log(
        `  batch=${log.batchId} (${log.batch.batchNo}) qty=${log.quantity} remaining=${log.batch.remainingQty}`
      );
    }
  } catch (err) {
    if (err instanceof PhysicalStockInsufficientError) {
      console.error("\n--- 物理库存熔断（事务已回滚）---");
      console.error(err.message);
    } else {
      console.error("\n--- 失败 ---");
      console.error(err);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
