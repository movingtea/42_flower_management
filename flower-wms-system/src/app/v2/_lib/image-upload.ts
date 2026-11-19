import {
  CMS_UPLOAD_MAX_BYTES,
  CMS_UPLOAD_PROXY_413_MESSAGE,
  CMS_UPLOAD_TOO_LARGE_MESSAGE,
} from "@/lib/cms-upload-limits";
import type { V2UploadModule } from "@/v2/domain/media";

export type V2ImageUploadResult = {
  objectKey: string;
  previewUrl: string;
};

type UploadApiResponse = {
  success: boolean;
  error?: string;
  code?: string;
  data?: {
    objectKey?: string;
    url?: string;
    path?: string;
  };
};

async function parseUploadResponse(res: Response): Promise<UploadApiResponse> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (res.status === 413) throw new Error(CMS_UPLOAD_PROXY_413_MESSAGE);
    throw new Error("上传失败，请稍后重试");
  }

  try {
    return (await res.json()) as UploadApiResponse;
  } catch {
    if (res.status === 413) throw new Error(CMS_UPLOAD_PROXY_413_MESSAGE);
    throw new Error("上传响应解析失败");
  }
}

function resolveUploadError(res: Response, json: UploadApiResponse): string {
  if (res.status === 413) return CMS_UPLOAD_PROXY_413_MESSAGE;
  if (json.code === "FILE_TOO_LARGE") {
    return json.error ?? CMS_UPLOAD_TOO_LARGE_MESSAGE;
  }
  return json.error ?? "上传失败，请稍后重试";
}

/**
 * WMS image upload. The form stores `objectKey`; the preview uses the public
 * OSS URL returned by the same response. Client-side size/type checks are a
 * convenience only — the V2 route repeats validation and enforces `catalog`.
 */
export async function uploadV2Image(
  file: File,
  module: V2UploadModule
): Promise<V2ImageUploadResult> {
  if (!file || file.size === 0) {
    throw new Error("请选择要上传的图片");
  }
  if (file.size > CMS_UPLOAD_MAX_BYTES) {
    throw new Error(CMS_UPLOAD_TOO_LARGE_MESSAGE);
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("仅支持 JPG、PNG、WebP 格式");
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("module", module);

  const res = await fetch("/api/v2/uploads/image", {
    method: "POST",
    body: fd,
  });

  const json = await parseUploadResponse(res);
  const objectKey = json.data?.objectKey ?? json.data?.path;
  const previewUrl = json.data?.url;

  if (!res.ok || !json.success || !objectKey || !previewUrl) {
    throw new Error(resolveUploadError(res, json));
  }

  return { objectKey, previewUrl };
}
