import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.v2.prisma",
  migrations: {
    path: "prisma/v2/migrations",
  },
  datasource: {
    url: process.env.V2_DATABASE_URL,
  },
});
