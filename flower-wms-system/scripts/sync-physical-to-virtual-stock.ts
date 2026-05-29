/**
 * 手动触发：大仓物理批次 → SKU 虚拟可售库存向下校准
 *
 * 用法：
 *   npx tsx scripts/sync-physical-to-virtual-stock.ts
 *
 * 需配置 .env 中的 DATABASE_URL。
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { syncPhysicalStockToVirtual } from "../src/services/inventory-sync";

async function main() {
  console.log("开始库存健康投影校准…\n");

  const result = await syncPhysicalStockToVirtual();

  console.log("\n校准完成：");
  console.log(`  扫描 SKU：${result.scanned}`);
  console.log(`  截断更新：${result.clamped}`);
  console.log(`  无需变更：${result.unchanged}`);
  console.log(`  配方异常归零：${result.zeroedByRecipe}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
