/**
 * Manual smoke test:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/smoke-product-decision.ts
 *
 * Reads product decisions for the last 30 days without modifying data.
 */
import { addAppCalendarDays, appDateStringFromParts, getAppCalendarParts } from "@/lib/datetime";
import { getProductDecisionReport } from "@/services/product-decision";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for smoke-product-decision");
}

async function main() {
  const todayParts = getAppCalendarParts(new Date());
  const startParts = addAppCalendarDays(todayParts, -30);
  const startDate = appDateStringFromParts(startParts);
  const endDate = appDateStringFromParts(todayParts);

  const report = await getProductDecisionReport({
    startDate,
    endDate,
    limit: 10,
  });

  console.log("Product decision smoke summary:");
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Products returned: ${report.products.length}`);
  console.log(`Recommended ranking: ${report.rankings.recommendedProducts.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
