import { PrismaClient, Role } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for seed");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";
const DEFAULT_PACKAGING_KITS = [
  { name: "基础花束包装", standardCost: "5.00" },
  { name: "标准礼赠包装", standardCost: "8.00" },
  { name: "高级品牌包装", standardCost: "15.00" },
  { name: "花盒包装", standardCost: "25.00" },
  { name: "节日限定包装", standardCost: "18.00" },
] as const;

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);

  await prisma.staffUser.upsert({
    where: { username: DEFAULT_ADMIN_USERNAME },
    create: {
      username: DEFAULT_ADMIN_USERNAME,
      passwordHash,
      role: Role.IT_ADMIN,
      displayName: "系统默认管理员",
    },
    update: {
      passwordHash,
      role: Role.IT_ADMIN,
      isActive: true,
      displayName: "系统默认管理员",
    },
  });

  for (const kit of DEFAULT_PACKAGING_KITS) {
    const existing = await prisma.packagingKit.findFirst({
      where: { name: kit.name },
      select: { id: true },
    });
    if (existing) {
      await prisma.packagingKit.update({
        where: { id: existing.id },
        data: { standardCost: kit.standardCost, isActive: true },
      });
    } else {
      await prisma.packagingKit.create({
        data: {
          name: kit.name,
          standardCost: kit.standardCost,
          isActive: true,
        },
      });
    }
  }

  console.log(
    `[seed] 默认管理员已就绪：${DEFAULT_ADMIN_USERNAME} / ${DEFAULT_ADMIN_PASSWORD}（角色 IT_ADMIN）`
  );
  console.log(`[seed] 默认包装方案已就绪：${DEFAULT_PACKAGING_KITS.length} 项`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
