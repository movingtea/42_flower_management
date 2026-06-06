/**
 * 定时执行虚拟库存健康投影（木桶校准）。
 * 由 docker-compose flower-cron-worker 启动；间隔默认 15 分钟。
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { syncPhysicalStockToVirtual } from "../src/services/inventory-sync";

const INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.INVENTORY_SYNC_INTERVAL_MS ?? 15 * 60 * 1000)
);

async function tick() {
  const started = Date.now();
  console.log(`[cron-inventory] sync start ${new Date().toISOString()}`);
  const result = await syncPhysicalStockToVirtual();
  console.log(
    `[cron-inventory] done in ${Date.now() - started}ms:`,
    JSON.stringify(result)
  );
}

async function main() {
  console.log(
    `[cron-inventory] daemon started, interval=${INTERVAL_MS}ms`
  );
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error("[cron-inventory] sync failed:", err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
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
