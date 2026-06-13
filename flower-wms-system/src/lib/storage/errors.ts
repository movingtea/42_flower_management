export type StorageErrorCode =
  | "INVALID_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "FILE_REQUIRED"
  | "UPLOAD_FAILED"
  | "STORAGE_NOT_CONFIGURED"
  | "INVALID_MODULE"
  | "INVALID_OBJECT_KEY";

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export function toSafeUploadErrorMessage(err: unknown): string {
  if (err instanceof StorageError) return err.message;
  return "图片上传失败，请稍后重试";
}
