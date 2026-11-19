import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma-v2/client";

const globalForV2 = globalThis as unknown as { v2Prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.V2_DATABASE_URL;
  if (!connectionString) throw new Error("V2_DATABASE_URL is required");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const v2db = globalForV2.v2Prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForV2.v2Prisma = v2db;
