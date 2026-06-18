/**
 * 小程序 API 图片 DTO 输出层（Batch C）。
 * 数据库存 objectKey；下发前转为 OSS public URL。
 * 客户端 normalizeImageUrl 仅作防御性兜底。
 */
import { toPublicImageUrl, toPublicImageUrlList } from "@/lib/image-url";

/** 逻辑图标 key，不是远程图片 URL，不得走 OSS 转换 */
export const MINIPROGRAM_LOGIC_ICON_KEYS = new Set([
  "iconKey",
  "localIconKey",
]);

/** 小程序 <image src> 单图字段：objectKey → https://oss.../；invalid → null */
export function toMiniprogramImageUrl(
  value: string | null | undefined
): string | null {
  return toPublicImageUrl(value);
}

/** 与列表/详情部分字段一致：无图时返回空字符串 */
export function toMiniprogramImageUrlOrEmpty(
  value: string | null | undefined
): string {
  return toMiniprogramImageUrl(value) ?? "";
}

/** 小程序 gallery / images[] */
export function toMiniprogramImageUrlList(
  values: string[] | null | undefined
): string[] {
  return toPublicImageUrlList(values);
}

/** 是否为可用于小程序 image src 的 OSS public URL */
export function isMiniprogramPublicImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return false;
  if (/localhost|127\.0\.0\.1/i.test(trimmed)) return false;
  if (trimmed.includes("/uploads/")) return false;
  if (/^https:\/\/www\.universe42\.studio\/universe42\//i.test(trimmed)) {
    return false;
  }
  return true;
}

/** objectKey 形态（裸 key，非 URL） */
export function isBareOssObjectKeyForMiniprogram(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("http") || trimmed.startsWith("/")) {
    return false;
  }
  return trimmed.startsWith("universe42/");
}
