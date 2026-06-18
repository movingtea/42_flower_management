/**
 * 静态检查：小程序 API 图片 DTO 不应裸返 objectKey
 * Run: npm run check:miniprogram-image-dto
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function checkMiniprogramRoutesUseFormatter() {
  const apiRoot = path.join(ROOT, "src/app/api/miniprogram");
  const routes: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") routes.push(full);
    }
  }
  walk(apiRoot);

  const violations: string[] = [];
  for (const file of routes) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    if (rel === "src/app/api/miniprogram/cart/route.ts") continue;
    if (src.includes("jsonSuccess(") && !src.includes("jsonWechatSuccess")) {
      violations.push(`${rel}: use jsonWechatSuccess for image DTO formatting`);
    }
    if (
      !src.includes("jsonWechatSuccess") &&
      !src.includes("jsonMiniProgramSuccess") &&
      !src.includes('from "@/app/api/cart/route"')
    ) {
      violations.push(`${rel}: missing jsonWechatSuccess`);
    }
  }

  if (violations.length) {
    console.error("check-miniprogram-image-dto route violations:");
    violations.forEach((v) => console.error(`  - ${v}`));
    process.exit(1);
  }
  console.log(`miniprogram routes OK (${routes.length} files)`);
}

function checkMapperUsesDto() {
  const mapper = read("src/lib/wechat-product-mapper.ts");
  if (!mapper.includes("miniprogram-image-dto")) {
    console.error("wechat-product-mapper must import miniprogram-image-dto");
    process.exit(1);
  }
  if (!mapper.includes("toMiniprogramImageUrl")) {
    console.error("wechat-product-mapper must call toMiniprogramImageUrl");
    process.exit(1);
  }
  console.log("wechat-product-mapper OK");
}

function checkFormatterKeys() {
  const fmt = read("src/utils/imageUrlFormatter.ts");
  for (const key of ["coverImage", "bannerImages", "snapshotImageUrl"]) {
    if (!fmt.includes(`"${key}"`)) {
      console.error(`imageUrlFormatter missing key: ${key}`);
      process.exit(1);
    }
  }
  if (!fmt.includes("MINIPROGRAM_LOGIC_ICON_KEYS")) {
    console.error("imageUrlFormatter must skip iconKey");
    process.exit(1);
  }
  console.log("imageUrlFormatter keys OK");
}

function main() {
  checkMapperUsesDto();
  checkFormatterKeys();
  checkMiniprogramRoutesUseFormatter();
  console.log("check-miniprogram-image-dto passed");
}

main();
