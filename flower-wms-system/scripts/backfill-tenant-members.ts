/**
 * 为全部 StaffUser 回填默认租户 TenantMember（幂等）。
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { backfillDefaultTenantMembers } from "../src/services/tenant";

async function main() {
  const result = await backfillDefaultTenantMembers();

  console.log(`Default tenant exists: ${result.tenantSlug}`);
  console.log(`Staff users found: ${result.staffUsersFound}`);
  console.log(`Tenant members created: ${result.membersCreated}`);
  console.log(`Tenant members skipped: ${result.membersSkipped}`);
  console.log(`Default flags updated: ${result.defaultFlagsUpdated}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
