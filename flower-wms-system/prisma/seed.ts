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

  console.log(
    `[seed] 默认管理员已就绪：${DEFAULT_ADMIN_USERNAME} / ${DEFAULT_ADMIN_PASSWORD}（角色 IT_ADMIN）`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
