/** 与 UPLOAD_MAX_SIZE_MB 默认一致；CMS 客户端上传前校验用 */
export const CMS_UPLOAD_MAX_SIZE_MB = 3;

export const CMS_UPLOAD_MAX_BYTES = CMS_UPLOAD_MAX_SIZE_MB * 1024 * 1024;

export const CMS_UPLOAD_TOO_LARGE_MESSAGE = `图片不能超过 ${CMS_UPLOAD_MAX_SIZE_MB}MB，请压缩后重试`;

export const CMS_UPLOAD_PROXY_413_MESSAGE =
  "图片过大或服务器上传限制未配置，请检查 Nginx client_max_body_size";
