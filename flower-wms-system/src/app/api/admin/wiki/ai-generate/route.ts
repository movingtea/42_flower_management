import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { generateWikiFromBase64, generateWikiFromImageBuffer } from "@/lib/wiki-ai";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("未配置") ||
      msg.includes("不能为空") ||
      msg.includes("须为") ||
      msg.includes("请上传")
    ) {
      return { message: msg, status: 400 };
    }
    return { message: msg, status: 500 };
  }
  return { message: "AI 生成 Wiki 失败", status: 500 };
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return jsonError('请使用 formData 上传，字段名为 "file"', 400);
      }
      if (file.size === 0) return jsonError("上传文件为空", 400);
      if (file.size > MAX_BYTES) {
        return jsonError("图片不能超过 10MB", 400);
      }
      if (!ALLOWED_TYPES.has(file.type)) {
        return jsonError("仅支持 JPG、PNG、WebP、GIF", 400);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const fields = await generateWikiFromImageBuffer(buffer, file.type);
      return jsonSuccess({ fields });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体 JSON", 400);
    }

    if (!raw || typeof raw !== "object") {
      return jsonError("请求体须为 JSON 对象", 400);
    }

    const body = raw as Record<string, unknown>;
    const base64 = typeof body.base64 === "string" ? body.base64 : "";
    const mimeType =
      typeof body.mimeType === "string" && body.mimeType
        ? body.mimeType
        : "image/jpeg";

    if (!base64) {
      return jsonError("请提供 base64 图片数据或 multipart 文件", 400);
    }

    const fields = await generateWikiFromBase64(base64, mimeType);
    return jsonSuccess({ fields });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return jsonError(`数据库错误 (${err.code})`, 500);
    }
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
