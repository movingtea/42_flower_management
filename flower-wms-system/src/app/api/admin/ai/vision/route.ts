import { jsonError, jsonSuccess } from "@/lib/api";
import {
  decomposeBouquetFromBase64,
  generateWikiFromImageBuffer,
  identifyFlowerLatinName,
} from "@/lib/wiki-ai";

export const dynamic = "force-dynamic";

const MAX = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function readImageFromRequest(request: Request) {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const fd = await request.formData();
    const file = fd.get("file");
    if (!file || !(file instanceof File)) {
      throw new Error('请上传 file 字段');
    }
    if (file.size > MAX) throw new Error("图片不能超过 10MB");
    if (!ALLOWED.has(file.type)) throw new Error("不支持的图片格式");
    const buffer = Buffer.from(await file.arrayBuffer());
    return { buffer, mimeType: file.type, base64: buffer.toString("base64") };
  }

  const body = (await request.json()) as { base64?: string; mimeType?: string };
  const base64 = body.base64?.replace(/^data:[^;]+;base64,/, "") ?? "";
  if (!base64) throw new Error("请提供 base64 或 multipart 文件");
  const mimeType = body.mimeType ?? "image/jpeg";
  return {
    buffer: Buffer.from(base64, "base64"),
    mimeType,
    base64,
  };
}

export async function POST(request: Request) {
  try {
    const { buffer, mimeType, base64 } = await readImageFromRequest(request);
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") ?? "wiki";

    if (mode === "identify") {
      const result = await identifyFlowerLatinName(base64, mimeType);
      return jsonSuccess(result);
    }

    if (mode === "bouquet") {
      const lines = await decomposeBouquetFromBase64(base64, mimeType);
      return jsonSuccess({
        lines: lines.map((l, i) => ({ ...l, key: `line-${i}-${Date.now()}` })),
      });
    }

    const fields = await generateWikiFromImageBuffer(buffer, mimeType);
    return jsonSuccess({ fields });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "AI 处理失败", 500);
  }
}
