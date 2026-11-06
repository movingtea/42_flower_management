import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.v2.draft.prisma",
  migrations: {
    path: "prisma/v2/migrations",
    seed: "tsx prisma/v2/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
