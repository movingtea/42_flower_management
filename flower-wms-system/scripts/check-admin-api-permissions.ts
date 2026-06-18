/**
 * 静态扫描：src/app/api/admin 下所有 route.ts 必须含 requirePermission（re-export 白名单除外）
 * Run: npm run check:admin-api-permissions
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_API_ROOT = path.join(__dirname, "../src/app/api/admin");

/** 仅 re-export 父 route，handler 权限在目标文件内 */
const REEXPORT_ONLY_WHITELIST: Array<{ file: string; reason: string }> = [
  {
    file: "categories/route.ts",
    reason: "deprecated re-export → product-categories/route.ts",
  },
  {
    file: "categories/[id]/route.ts",
    reason: "deprecated re-export → product-categories/[id]/route.ts",
  },
];

const HTTP_HANDLER_RE =
  /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;

function isReExportOnly(content: string): boolean {
  const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = withoutBlockComments
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  const hasLocalHandler = HTTP_HANDLER_RE.test(content);
  HTTP_HANDLER_RE.lastIndex = 0;
  if (hasLocalHandler) return false;
  return lines.every(
    (line) =>
      line.startsWith("export {") && line.includes("} from ") ||
      line.startsWith("export type") ||
      line.startsWith("export const")
  );
}

function listRouteFiles(dir: string, base = ""): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRouteFiles(full, rel));
    } else if (entry.name === "route.ts") {
      files.push(rel.replace(/\\/g, "/"));
    }
  }
  return files.sort();
}

function findLocalHandlers(content: string): string[] {
  const methods: string[] = [];
  let m: RegExpExecArray | null;
  const re = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
  while ((m = re.exec(content)) !== null) {
    methods.push(m[1]);
  }
  return methods;
}

function isWhitelisted(relativeFile: string): string | null {
  const hit = REEXPORT_ONLY_WHITELIST.find((w) => w.file === relativeFile);
  return hit ? hit.reason : null;
}

export function checkAdminApiPermissions(): {
  scanned: number;
  violations: Array<{ file: string; methods: string[] }>;
} {
  const routeFiles = listRouteFiles(ADMIN_API_ROOT);
  const violations: Array<{ file: string; methods: string[] }> = [];

  for (const file of routeFiles) {
    const full = path.join(ADMIN_API_ROOT, file);
    const content = fs.readFileSync(full, "utf8");
    const whitelistReason = isWhitelisted(file);
    if (whitelistReason) continue;

    const methods = findLocalHandlers(content);
    if (methods.length === 0) continue;

    if (isReExportOnly(content)) continue;

    if (!content.includes("requirePermission")) {
      violations.push({ file, methods });
    }
  }

  return { scanned: routeFiles.length, violations };
}

function main() {
  const { scanned, violations } = checkAdminApiPermissions();
  if (violations.length > 0) {
    console.error("check-admin-api-permissions FAILED:");
    for (const v of violations) {
      console.error(
        `  - ${v.file} [${v.methods.join(", ")}] missing requirePermission`
      );
    }
    process.exit(1);
  }
  console.log(
    `check-admin-api-permissions passed (${scanned} route files scanned, ${REEXPORT_ONLY_WHITELIST.length} re-export whitelist)`
  );
}

const isDirectRun =
  process.argv[1]?.replace(/\\/g, "/").endsWith("check-admin-api-permissions.ts") ??
  false;

if (isDirectRun) {
  main();
}
