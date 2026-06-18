/**
 * 静态检查：生产 env 示例是否包含 OSS / 上传关键变量
 * Run: npm run check:production-env-example
 *
 * 不读取真实 .env，不输出任何密钥值。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");
const PROD_EXAMPLE = path.join(REPO_ROOT, ".env.production.example");
const DEV_EXAMPLE = path.join(__dirname, "../.env.example");

const REQUIRED_IN_PRODUCTION = [
  "ENABLE_OSS_UPLOAD",
  "ALIYUN_OSS_REGION",
  "ALIYUN_OSS_BUCKET",
  "ALIYUN_OSS_ENDPOINT",
  "ALIYUN_OSS_ACCESS_KEY_ID",
  "ALIYUN_OSS_ACCESS_KEY_SECRET",
  "ALIYUN_OSS_OBJECT_PREFIX",
  "ALIYUN_OSS_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_OSS_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_OSS_OBJECT_PREFIX",
  "UPLOAD_MAX_SIZE_MB",
] as const;

const RECOMMENDED_IN_PRODUCTION = [
  "STORAGE_DRIVER",
  "ENABLE_LEGACY_UPLOADS",
  "ALIYUN_OSS_INTERNAL_ENDPOINT",
  "ALIYUN_OSS_UPLOAD_ENDPOINT",
  "DATABASE_URL",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
] as const;

const FORBIDDEN_IN_NEXT_PUBLIC = [
  "ACCESS_KEY",
  "SECRET",
  "INTERNAL_ENDPOINT",
] as const;

function parseEnvKeys(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    map.set(key, value);
  }
  return map;
}

function checkProductionExample(): string[] {
  const errors: string[] = [];

  if (!fs.existsSync(PROD_EXAMPLE)) {
    errors.push(`missing file: ${PROD_EXAMPLE}`);
    return errors;
  }

  const content = fs.readFileSync(PROD_EXAMPLE, "utf8");
  const keys = parseEnvKeys(content);

  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!keys.has(key)) {
      errors.push(`.env.production.example missing required key: ${key}`);
    }
  }

  for (const key of RECOMMENDED_IN_PRODUCTION) {
    if (!keys.has(key)) {
      errors.push(`.env.production.example missing recommended key: ${key}`);
    }
  }

  const uploadMb = keys.get("UPLOAD_MAX_SIZE_MB");
  if (uploadMb !== "3") {
    errors.push(
      `.env.production.example UPLOAD_MAX_SIZE_MB should be 3 (got ${uploadMb ?? "missing"})`
    );
  }

  for (const [key, value] of keys) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    for (const forbidden of FORBIDDEN_IN_NEXT_PUBLIC) {
      if (key.toUpperCase().includes(forbidden)) {
        errors.push(
          `.env.production.example NEXT_PUBLIC key must not contain ${forbidden}: ${key}`
        );
      }
    }
    if (/your-access-key|real-secret|sk-/i.test(value)) {
      // placeholder values in NEXT_PUBLIC are ok; only flag if value looks like leaked secret in NEXT_PUBLIC
      if (key.includes("SECRET") || key.includes("ACCESS_KEY")) {
        errors.push(`suspicious secret-like value in NEXT_PUBLIC key: ${key}`);
      }
    }
  }

  if (
    keys.has("ALIYUN_OSS_ACCESS_KEY_ID") &&
    content.includes("NEXT_PUBLIC_ALIYUN_OSS_ACCESS_KEY")
  ) {
    errors.push("AccessKey must not use NEXT_PUBLIC_ prefix");
  }

  return errors;
}

function checkDevExampleOssNaming(): string[] {
  const errors: string[] = [];
  if (!fs.existsSync(DEV_EXAMPLE)) return errors;

  const devKeys = new Set(parseEnvKeys(fs.readFileSync(DEV_EXAMPLE, "utf8")).keys());
  const prodKeys = new Set(
    parseEnvKeys(fs.readFileSync(PROD_EXAMPLE, "utf8")).keys()
  );

  for (const key of REQUIRED_IN_PRODUCTION) {
    if (devKeys.has(key) !== prodKeys.has(key)) {
      errors.push(
        `.env.example vs .env.production.example OSS key mismatch: ${key}`
      );
    }
  }

  return errors;
}

function main() {
  const errors = [...checkProductionExample(), ...checkDevExampleOssNaming()];

  if (errors.length > 0) {
    console.error("check-production-env-example FAILED:");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log(
    "check-production-env-example passed (.env.production.example + .env.example OSS naming aligned)"
  );
}

main();
