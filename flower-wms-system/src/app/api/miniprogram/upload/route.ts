import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { jsonError } from "@/lib/api";
import { requireUserFromRequest } from "@/lib/wechat-auth-request";
import { jsonWechatSuccess } from "@/lib/wechat-api";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function ensureInsideUploadDir(targetPath: string): boolean {
  const base = path.resolve(UPLOAD_DIR);
  const resolved = path.resolve(targetPath);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

/** POST：小程序用户上传头像（需 Bearer Token） */
export async function POST(request: Request) {
  try {
    await requireUserFromRequest(request);

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
      return jsonError("图片不能超过 5MB", 400);
    }

    const ext = ALLOWED_IMAGE_TYPES[entry.type];
    if (!ext) {
      return jsonError("仅支持 JPG、PNG、WebP 格式", 400);
    }

    await mkdir(UPLOAD_DIR, { recursive: true });

    const filename = `${Date.now()}-${randomBytes(4).toString("hex")}${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    if (!ensureInsideUploadDir(filePath)) {
      return jsonError("非法保存路径", 400);
    }

    const buffer = Buffer.from(await entry.arrayBuffer());
    await writeFile(filePath, buffer);

    const publicPath = `/uploads/${filename}`;

    return jsonWechatSuccess({
      message: "上传成功",
      url: publicPath,
      path: publicPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "上传失败";
    const status =
      message.includes("未登录") || message.includes("过期") ? 401 : 500;
    return jsonError(message, status);
  }
}
