import type { UploadModule } from "@/lib/storage/object-key";
import {
  CMS_UPLOAD_MAX_BYTES,
  CMS_UPLOAD_PROXY_413_MESSAGE,
  CMS_UPLOAD_TOO_LARGE_MESSAGE,
} from "@/lib/cms-upload-limits";

export type CmsImageUploadResult = {
  objectKey: string;
  previewUrl: string;
};

export {
  CMS_IMAGE_INVALID_LOAD_HINT,
  CMS_IMAGE_REUPLOAD_HINT,
  getClientPreviewImageUrl,
  isClientImageInvalid,
  resolveClientImagePreview,
} from "@/lib/client-image-preview";

export {
  CMS_UPLOAD_MAX_SIZE_MB,
  CMS_UPLOAD_TOO_LARGE_MESSAGE,
  CMS_UPLOAD_PROXY_413_MESSAGE,
} from "@/lib/cms-upload-limits";

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
    if (res.status === 413) {
      throw new Error(CMS_UPLOAD_PROXY_413_MESSAGE);
    }
    throw new Error("上传失败，请稍后重试");
  }

  try {
    return (await res.json()) as UploadApiResponse;
  } catch {
    if (res.status === 413) {
      throw new Error(CMS_UPLOAD_PROXY_413_MESSAGE);
    }
    throw new Error("上传响应解析失败");
  }
}

function resolveUploadError(res: Response, json: UploadApiResponse): string {
  if (res.status === 413) {
    return CMS_UPLOAD_PROXY_413_MESSAGE;
  }
  if (json.code === "FILE_TOO_LARGE") {
    return json.error ?? CMS_UPLOAD_TOO_LARGE_MESSAGE;
  }
  return json.error ?? "上传失败，请稍后重试";
}

/**
 * CMS 客户端统一 OSS 图片上传。
 * 表单保存 objectKey；预览使用 previewUrl（public URL）。
 */
export async function uploadCmsImage(
  file: File,
  module: UploadModule
): Promise<CmsImageUploadResult> {
  if (!file || file.size === 0) {
    throw new Error("请选择要上传的图片");
  }

  if (file.size > CMS_UPLOAD_MAX_BYTES) {
    throw new Error(CMS_UPLOAD_TOO_LARGE_MESSAGE);
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("module", module);

  const res = await fetch("/api/admin/uploads/image", {
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
