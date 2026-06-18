/**
 * 静态检查：Nginx 示例配置含 client_max_body_size 5m
 * Run: npm run check:nginx-upload-limit
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NGINX_EXAMPLE = path.join(
  __dirname,
  "../../deploy/nginx/conf.d/flower.conf.example"
);

function main() {
  if (!fs.existsSync(NGINX_EXAMPLE)) {
    console.error(`check-nginx-upload-limit FAILED: missing ${NGINX_EXAMPLE}`);
    process.exit(1);
  }

  const content = fs.readFileSync(NGINX_EXAMPLE, "utf8");
  const match = content.match(/client_max_body_size\s+(\d+[kmg]?)\s*;/i);

  if (!match) {
    console.error(
      "check-nginx-upload-limit FAILED: client_max_body_size not found in flower.conf.example"
    );
    process.exit(1);
  }

  const value = match[1].toLowerCase();
  if (value !== "5m") {
    console.error(
      `check-nginx-upload-limit FAILED: expected client_max_body_size 5m, got ${match[1]}`
    );
    process.exit(1);
  }

  if (!content.includes("UPLOAD_MAX_SIZE_MB")) {
    console.warn(
      "check-nginx-upload-limit WARN: no UPLOAD_MAX_SIZE_MB comment in nginx example (recommended)"
    );
  }

  console.log(
    `check-nginx-upload-limit passed (${NGINX_EXAMPLE} client_max_body_size 5m)`
  );
}

main();
