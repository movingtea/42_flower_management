import { defineConfig } from "prisma/config";
import { loadV2Env } from "./scripts/load-v2-env.mjs";

// Match Next.js local development: the process environment wins, then
// `.env.<mode>.local`, `.env.local`, `.env.<mode>` and `.env`. This lets the
// V2 commands reuse the same `.env.local` connection string as `next dev`
// without copying `V2_DATABASE_URL` into `.env`.
loadV2Env();

export default defineConfig({
  schema: "prisma/schema.v2.prisma",
  migrations: {
    path: "prisma/v2/migrations",
  },
  datasource: {
    url: process.env.V2_DATABASE_URL,
  },
});
