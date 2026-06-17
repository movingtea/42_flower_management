import { jsonError } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { StorageError } from "@/lib/storage/errors";
import { parseUploadModule, type UploadModule } from "@/lib/storage/object-key";
import {
  auditImageUpload,
  handleAdminImageUpload,
} from "@/lib/storage/upload-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

/** POST /api/admin/uploads/image — CMS/WMS 统一 OSS 图片上传 */
export async function POST(request: Request) {
  const staff = await requirePermission("cms:write");
  if (isResponse(staff)) return staff;

  const clone = request.clone();
  let uploadModule: UploadModule = "cms";
  try {
    const fd = await clone.formData();
    uploadModule = parseUploadModule(fd.get("module") ?? "cms");
  } catch (err) {
    if (err instanceof StorageError) {
      return jsonError(err.message, storageErrorStatus(err.code), err.code);
    }
    throw err;
  }

  const response = await handleAdminImageUpload(request);
  if (response.ok) {
    try {
      const json = (await response.clone().json()) as {
        success?: boolean;
        data?: { objectKey?: string; size?: number };
      };
      if (json.success && json.data?.objectKey) {
        auditImageUpload(staff, {
          objectKey: json.data.objectKey,
          module: uploadModule,
          size: json.data.size ?? 0,
        });
      }
    } catch {
      // audit failure must not break upload
    }
  }
  return response;
}
