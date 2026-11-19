import { jsonError, jsonSuccess } from "@/lib/api";
import { StorageError, toSafeUploadErrorMessage } from "@/lib/storage/errors";
import { uploadImageToStorage } from "@/lib/storage/storage";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { parseV2UploadModule, type V2UploadModule } from "@/v2/domain/media";

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

/**
 * POST /api/v2/uploads/image — WMS-owned OSS image upload.
 *
 * The V1/CMS upload route requires `cms:write`, which WMS roles do not hold.
 * This route reuses the same storage validation and object-key builder but
 * authorizes against the V2 `catalog` capability and only accepts WMS modules
 * (materials/products/skus), so a WMS upload can never be written into a CMS
 * banner or recommendation path.
 */
export async function POST(request: Request) {
  let scope: Awaited<ReturnType<typeof requireV2Store>>;
  try {
    scope = await requireV2Store("catalog");
  } catch (cause) {
    return jsonError(
      cause instanceof Error ? cause.message : "当前账号没有图片上传权限",
      403,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("无法解析 multipart/form-data", 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return jsonError('请使用 formData 上传，字段名为 "file"', 400);
  }

  let uploadModule: V2UploadModule;
  try {
    uploadModule = parseV2UploadModule(formData.get("module") ?? "wms-material");
  } catch (cause) {
    if (cause instanceof StorageError) {
      return jsonError(cause.message, storageErrorStatus(cause.code), cause.code);
    }
    throw cause;
  }

  try {
    const result = await uploadImageToStorage({ file, module: uploadModule });

    // The image is already stored; an audit write failure must not turn a
    // successful upload into a client-visible 500. The upload action is audited
    // separately by the V2 catalog mutation that references the objectKey.
    try {
      await v2db.auditEvent.create({
        data: {
          tenantId: scope.tenantId,
          storeId: scope.storeId,
          actorStaffId: scope.staffId,
          action: "IMAGE_UPLOADED",
          entityType: "Image",
          entityId: result.objectKey,
          afterSnapshot: {
            objectKey: result.objectKey,
            module: uploadModule,
            size: result.size,
            mimeType: result.mimeType,
          },
        },
      });
    } catch {
      // ignore audit errors
    }

    return jsonSuccess({
      objectKey: result.objectKey,
      url: result.publicUrl,
      path: result.objectKey,
      mimeType: result.mimeType,
      size: result.size,
      message: "上传成功",
    });
  } catch (cause) {
    if (cause instanceof StorageError) {
      return jsonError(
        cause.message,
        storageErrorStatus(cause.code),
        cause.code,
      );
    }
    return jsonError(toSafeUploadErrorMessage(cause), 500);
  }
}
