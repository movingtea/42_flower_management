import type { UploadModule } from "@/lib/storage/object-key";

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

type UploadApiResponse = {
  success: boolean;
  error?: string;
  data?: {
    objectKey?: string;
    url?: string;
    path?: string;
  };
};

/**
 * CMS 客户端统一 OSS 图片上传。
 * 表单保存 objectKey；预览使用 previewUrl（public URL）。
 */
export async function uploadCmsImage(
  file: File,
  module: UploadModule
): Promise<CmsImageUploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("module", module);

  const res = await fetch("/api/admin/uploads/image", {
    method: "POST",
    body: fd,
  });

  const json = (await res.json()) as UploadApiResponse;
  const objectKey = json.data?.objectKey ?? json.data?.path;
  const previewUrl = json.data?.url;

  if (!res.ok || !json.success || !objectKey || !previewUrl) {
    throw new Error(json.error ?? "上传失败，请稍后重试");
  }

  return { objectKey, previewUrl };
}
