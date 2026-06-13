import { jsonError, jsonSuccess } from "@/lib/api";
import type { StaffSession } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { StorageError, toSafeUploadErrorMessage } from "@/lib/storage/errors";
import { parseUploadModule } from "@/lib/storage/object-key";
import { uploadImageToStorage } from "@/lib/storage/storage";

export type AdminImageUploadResponse = {
  ok: true;
  objectKey: string;
  url: string;
  mimeType: string;
  size: number;
  message: string;
};

function storageErrorStatus(code: StorageError["code"]): number {
  switch (code) {
    case "STORAGE_NOT_CONFIGURED":
      return 503;
    case "UPLOAD_FAILED":
      return 502;
    default:
      return 400;
  }
}

export async function handleAdminImageUpload(
  request: Request,
  options?: { defaultModule?: string }
): Promise<Response> {
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

    const moduleRaw = formData.get("module") ?? options?.defaultModule ?? "cms";
    let module;
    try {
      module = parseUploadModule(moduleRaw);
    } catch (err) {
      if (err instanceof StorageError) {
        return jsonError(err.message, 400);
      }
      throw err;
    }

    const result = await uploadImageToStorage({ file: entry, module });

    return jsonSuccess({
      ok: true,
      message: "上传成功",
      objectKey: result.objectKey,
      url: result.publicUrl,
      path: result.objectKey,
      mimeType: result.mimeType,
      size: result.size,
    } satisfies AdminImageUploadResponse & { path: string });
  } catch (err) {
    if (err instanceof StorageError) {
      return jsonError(err.message, storageErrorStatus(err.code));
    }
    return jsonError(toSafeUploadErrorMessage(err), 500);
  }
}

export function auditImageUpload(
  staff: StaffSession,
  payload: { objectKey: string; module: string; size: number }
): void {
  safeLogAuditFromStaff(staff, {
    module: "CMS",
    action: "UPLOAD_IMAGE",
    entityType: "Image",
    entityId: payload.objectKey,
    summary: `上传图片 ${payload.module}`,
    metadata: {
      objectKey: payload.objectKey,
      module: payload.module,
      size: payload.size,
    },
  });
}
