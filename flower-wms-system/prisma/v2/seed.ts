import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../../src/generated/prisma-v2/client";
import { isStrongV2Password } from "../../src/v2/password-policy";
import {
  DEFAULT_TEST_TIERS,
  SeedTierError,
  TIER_FLAG,
  parseTierList,
  type SeedTier,
} from "./seed/contract";
import { runTieredSeed } from "./seed/orchestrator";
import { runProductionBootstrap } from "./seed/production";
import { SEED_MODES, type SeedMode } from "./seed/types";

const rawMode = process.argv[2];
if (!(SEED_MODES as readonly string[]).includes(rawMode ?? "")) {
  throw new Error("Choose a db:v2:seed, db:v2:reset or db:v2:init package command");
}
const mode = rawMode as SeedMode;

/**
 * E1.4 tier CLI contract.
 *
 * - `test` / `reset-test` accept `--tiers=minimum,roles,p1-scenarios,e2e-fixtures`.
 *   With no flag the historical default dataset (minimum + roles) is applied.
 * - `dev` keeps its historical admin-only dataset and rejects `--tiers`.
 * - `production` always bootstraps the minimum baseline + one admin and rejects
 *   `--tiers` so test fixtures can never leak into a production initialisation.
 */
function parseSeedTiers(seedMode: SeedMode): readonly SeedTier[] {
  const args = process.argv.slice(3);
  let rawTiers: string | undefined;
  for (const arg of args) {
    if (arg.startsWith(TIER_FLAG)) {
      if (rawTiers !== undefined) {
        throw new SeedTierError("--tiers 只能提供一次");
      }
      rawTiers = arg.slice(TIER_FLAG.length);
      continue;
    }
    if (arg === "--tiers") {
      throw new SeedTierError(
        "--tiers 需要以 --tiers=minimum,roles 的形式提供值",
      );
    }
    throw new SeedTierError(`未知参数 "${arg}"`);
  }

  if (seedMode === "production") {
    if (rawTiers !== undefined) {
      throw new SeedTierError("production 模式不接受 --tiers");
    }
    return [];
  }
  if (seedMode === "dev") {
    if (rawTiers !== undefined) {
      throw new SeedTierError(
        "--tiers 仅用于 test/reset-test 模式；dev 固定创建 minimum + 管理员账号",
      );
    }
    return DEFAULT_TEST_TIERS;
  }
  if (rawTiers === undefined) return DEFAULT_TEST_TIERS;
  return parseTierList(rawTiers);
}

const tiers = parseSeedTiers(mode);

const connectionString = process.env.V2_DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL is required");
const target = new URL(connectionString);
if (!["postgres:", "postgresql:"].includes(target.protocol) || !target.hostname ||
    !/^\/[a-z][a-z0-9_]*$/.test(target.pathname)) {
  throw new Error("V2_DATABASE_URL must name a PostgreSQL database");
}
if (process.env.DATABASE_URL &&
    decodeURIComponent(new URL(process.env.DATABASE_URL).pathname) === target.pathname) {
  throw new Error("V1 and V2 must use distinct PostgreSQL database names");
}
if (mode !== "production") {
  const suffix = mode === "dev" ? "_dev" : "_test";
  if (process.env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      !target.pathname.endsWith(suffix) ||
      [...target.searchParams].some(([key, value]) => key !== "schema" || value !== "public")) {
    throw new Error(`Use a local PostgreSQL database ending in ${suffix} with the public schema`);
  }
}

if (mode === "reset-test") {
  execFileSync(process.execPath, [
    resolve("node_modules/prisma/build/index.js"), "migrate", "reset", "--force",
    "--config", "prisma.v2.config.ts",
  ], { stdio: "inherit" });
}

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  if (mode === "production") {
    const username = process.env.V2_BOOTSTRAP_ADMIN_USERNAME?.trim();
    const passwordFile = process.env.V2_BOOTSTRAP_ADMIN_PASSWORD_FILE;
    if (!username || !passwordFile) {
      throw new Error("Set V2_BOOTSTRAP_ADMIN_USERNAME and V2_BOOTSTRAP_ADMIN_PASSWORD_FILE");
    }
    if (await client.staffUser.findUnique({ where: { username } })) {
      console.log("Bootstrap username already exists. Existing credentials and memberships were preserved.");
      return;
    }
    // Never surface the file system error: it contains the absolute password
    // file path. A fixed message keeps the failure actionable without leaking
    // the path or any credential material.
    let password: string;
    try {
      password = (await readFile(passwordFile, "utf8")).replace(/\r?\n$/, "");
    } catch {
      throw new Error("Unable to read the V2 bootstrap password file");
    }
    if (!isStrongV2Password(password, username)) {
      throw new Error("The bootstrap password does not meet the V2 password policy");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await runProductionBootstrap(client, { username, passwordHash });
    console.log("Seeded tenant default and store MAIN");
    return;
  }

  await runTieredSeed(client, { mode, tiers });
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
