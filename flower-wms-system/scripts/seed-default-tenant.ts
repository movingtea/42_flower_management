/**
 * 创建或确认默认租户 universe42（幂等）。
 */
import "dotenv/config";
import { ensureDefaultTenant } from "../src/services/tenant";

async function main() {
  const tenant = await ensureDefaultTenant();
  console.log(`Default tenant exists: ${tenant.slug}`);
  console.log(`Tenant id: ${tenant.id}`);
  console.log(`Tenant name: ${tenant.name}`);
  console.log(`Tenant status: ${tenant.status}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  });
