/**
 * Manual smoke test:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/smoke-purchase-analytics.ts
 *
 * Reads purchase analytics for the last 30 days without modifying data.
 */
import { getPurchaseAnalyticsReport } from "@/services/purchase-analytics";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for smoke-purchase-analytics");
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function main() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);

  const report = await getPurchaseAnalyticsReport({
    startDate: formatDate(start),
    endDate: formatDate(end),
    limit: 10,
  });

  console.log("Purchase analytics smoke summary:");
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Supplier ranking: ${report.supplierRanking.length}`);
  console.log(`Flower price trends: ${report.flowerPriceTrends.length}`);
  console.log(`Batch sales conversion: ${report.batchSalesConversion.length}`);
  console.log(`Batch cost contribution: ${report.batchCostContribution.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
