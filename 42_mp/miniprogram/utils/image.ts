import {
  normalizeImageUrl,
  normalizeImageUrlList,
  placeholderImagePath,
} from './image-url';

export { placeholderImagePath, normalizeImageUrl, normalizeImageUrlList } from './image-url';
export { isLocalMiniProgramAsset } from './image-url';

/** @deprecated 使用 normalizeImageUrl — 现返回完整可展示 URL，不再返回相对路径 */
export function toRelativeImagePath(src?: string | null): string {
  return normalizeImageUrl(src);
}

/** 拼接为完整可访问 URL（购物车缓存、富文本等） */
export function resolveImageUrl(src?: string | null): string {
  return normalizeImageUrl(src);
}

export function resolveImageUrlList(urls: string[]): string[] {
  return normalizeImageUrlList(urls);
}

export function toRelativeImagePathList(urls: string[]): string[] {
  return normalizeImageUrlList(urls);
}

/** 富文本 HTML 内图片 src 规范为可访问 URL（OSS / 占位；拒绝 localhost /uploads） */
export function rewriteRichTextImageSrc(html: string): string {
  if (!html || typeof html !== 'string') return html;

  return html.replace(
    /(src=["'])([^"']+)(["'])/gi,
    (_match, prefix: string, src: string, suffix: string) => {
      const normalized = normalizeImageUrl(src);
      return `${prefix}${normalized}${suffix}`;
    }
  );
}
