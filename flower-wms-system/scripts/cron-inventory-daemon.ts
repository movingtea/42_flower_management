/**
 * Cron worker：虚拟库存投影 + 过期待支付订单关闭。
 * 由 docker-compose flower-cron-worker 启动。
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { syncPhysicalStockToVirtual } from "../src/services/inventory-sync";
import { closeExpiredPendingOrders } from "../src/services/order-lifecycle";

const INVENTORY_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.INVENTORY_SYNC_INTERVAL_MS ?? 15 * 60 * 1000)
);

const ORDER_EXPIRY_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.ORDER_EXPIRY_INTERVAL_MS ?? 60 * 1000)
);

let lastInventoryRun = 0;
let lastOrderExpiryRun = 0;

async function runInventorySync() {
  const started = Date.now();
  console.log(`[cron-inventory] sync start ${new Date().toISOString()}`);
  const result = await syncPhysicalStockToVirtual();
  console.log(
    `[cron-inventory] done in ${Date.now() - started}ms:`,
    JSON.stringify(result)
  );
}

async function runOrderExpiry() {
  const started = Date.now();
  console.log(`[cron-order-expiry] start ${new Date().toISOString()}`);
  const result = await closeExpiredPendingOrders();
  console.log(
    `[cron-order-expiry] done in ${Date.now() - started}ms:`,
    JSON.stringify(result)
  );
}

async function tick() {
  const now = Date.now();
  if (now - lastInventoryRun >= INVENTORY_INTERVAL_MS) {
    lastInventoryRun = now;
    try {
      await runInventorySync();
    } catch (err) {
      console.error("[cron-inventory] sync failed:", err);
    }
  }

  if (now - lastOrderExpiryRun >= ORDER_EXPIRY_INTERVAL_MS) {
    lastOrderExpiryRun = now;
    try {
      await runOrderExpiry();
    } catch (err) {
      console.error("[cron-order-expiry] failed:", err);
    }
  }
}

async function main() {
  console.log(
    `[cron-worker] started inventory=${INVENTORY_INTERVAL_MS}ms orderExpiry=${ORDER_EXPIRY_INTERVAL_MS}ms`
  );
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error("[cron-worker] tick failed:", err);
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
