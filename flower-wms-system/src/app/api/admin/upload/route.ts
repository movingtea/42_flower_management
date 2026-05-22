import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { jsonError, jsonSuccess } from "@/lib/api";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/** MIME → 允许保存的后缀 */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const ALLOWED_EXTENSIONS = new Set(
  Object.values(ALLOWED_IMAGE_TYPES).map((e) => e.slice(1))
);

function resolveExtension(file: File, mimeExt: string): string | null {
  const raw = path.extname(file.name).toLowerCase().replace(/^\./, "");
  if (raw && ALLOWED_EXTENSIONS.has(raw)) {
    const mapped = ALLOWED_IMAGE_TYPES[file.type];
    if (mapped) return mapped;
    return `.${raw}`;
  }
  return mimeExt;
}

function ensureInsideUploadDir(targetPath: string): boolean {
  const base = path.resolve(UPLOAD_DIR);
  const resolved = path.resolve(targetPath);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

export async function POST(request: Request) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError("无法解析 multipart/form-data", 400);
    }

    const entry = formData.get("file");
    if (!entry || !(entry instanceof File)) {
      return jsonError('请使用 formData 上传，字段名为 "file"', 400);
    }

    if (entry.size === 0) {
      return jsonError("上传文件为空", 400);
    }

    if (entry.size > MAX_FILE_SIZE) {
      return jsonError(`图片不能超过 ${MAX_FILE_SIZE / 1024 / 1024}MB`, 400);
    }

    const mimeExt = ALLOWED_IMAGE_TYPES[entry.type];
    if (!mimeExt) {
      return jsonError("仅支持 JPG、PNG、WebP、GIF 格式", 400);
    }

    const ext = resolveExtension(entry, mimeExt);
    if (!ext) {
      return jsonError("文件扩展名与类型不匹配", 400);
    }

    await mkdir(UPLOAD_DIR, { recursive: true });

    const random = randomBytes(4).toString("hex");
    const filename = `${Date.now()}-${random}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    if (!ensureInsideUploadDir(filePath)) {
      return jsonError("非法保存路径", 400);
    }

    const buffer = Buffer.from(await entry.arrayBuffer());
    await writeFile(filePath, buffer);

    const publicPath = `/uploads/${filename}`;

    return jsonSuccess({
      message: "上传成功",
      url: publicPath,
      path: publicPath,
      filename,
      size: entry.size,
      mimeType: entry.type,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "图片上传失败，请稍后重试";
    return jsonError(message, 500);
  }
}
