import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const PLACEHOLDER_PATH = path.join(
  process.cwd(),
  "public",
  "images",
  "product-placeholder.svg"
);

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function mimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function isSafeFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return false;
  }
  return /^[a-zA-Z0-9._-]+$/.test(filename);
}

async function servePlaceholder(): Promise<NextResponse> {
  try {
    const buf = await readFile(PLACEHOLDER_PATH);
    return new NextResponse(buf, {
      status: 404,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect fill="#f3f3f3" width="400" height="400"/><text x="200" y="210" text-anchor="middle" fill="#999" font-size="20" font-family="sans-serif">暂无图片</text></svg>';
    return new NextResponse(svg, {
      status: 404,
      headers: { "Content-Type": "image/svg+xml" },
    });
  }
}

/** 安全读取 uploads 文件；缺失时返回占位图（404，非 500） */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path?: string[] }> }
) {
  try {
    const { path: segments } = await context.params;
    const filename = path.basename((segments ?? []).join("/") || "");

    if (!isSafeFilename(filename)) {
      return servePlaceholder();
    }

    const filePath = path.join(UPLOAD_DIR, filename);
    const resolved = path.resolve(filePath);
    const base = path.resolve(UPLOAD_DIR);

    if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
      return servePlaceholder();
    }

    const buffer = await readFile(resolved);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeFromFilename(filename),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as NodeJS.ErrnoException).code)
        : "";

    if (code === "ENOENT") {
      return servePlaceholder();
    }

    console.error("[uploads] 读取失败:", err);
    return servePlaceholder();
  }
}
