import { jsonError } from "@/lib/api";
import { requireUserFromRequest } from "@/lib/wechat-auth-request";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { StorageError, toSafeUploadErrorMessage } from "@/lib/storage/errors";
import { uploadImageToStorage } from "@/lib/storage/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST：小程序用户上传头像（需 Bearer Token，OSS module=cms） */
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

    const result = await uploadImageToStorage({ file: entry, module: "cms" });

    return jsonWechatSuccess({
      message: "上传成功",
      objectKey: result.objectKey,
      url: result.publicUrl,
      path: result.objectKey,
    });
  } catch (err) {
    if (err instanceof StorageError) {
      const status =
        err.code === "STORAGE_NOT_CONFIGURED"
          ? 503
          : err.code === "UPLOAD_FAILED"
            ? 502
            : 400;
      return jsonError(err.message, status, err.code);
    }
    const message = err instanceof Error ? err.message : toSafeUploadErrorMessage(err);
    const status =
      message.includes("未登录") || message.includes("过期") ? 401 : 500;
    return jsonError(message, status);
  }
}
