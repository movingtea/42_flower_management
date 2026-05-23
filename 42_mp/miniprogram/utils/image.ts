import { baseUrl } from '../config/index';

/** 占位图相对路径（由 baseUrl 拼接后访问 Next public/images） */
export const placeholderImagePath = '/images/product-placeholder.svg';

/** 从 http(s) 绝对地址提取路径（不依赖 DOM URL，兼容小程序 TS lib） */
function pathnameFromAbsoluteUrl(absolute: string): string {
  const withoutScheme = absolute.replace(/^https?:\/\//i, '');
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex < 0) return placeholderImagePath;

  const path = withoutScheme.slice(slashIndex).split(/[?#]/)[0];
  return path || placeholderImagePath;
}

/**
 * 规范为相对路径（供 WXML：{{baseUrl}}{{imagePath}}）。
 * 绝对 URL 会提取 pathname；空值返回占位图路径。
 */
export function toRelativeImagePath(src?: string | null): string {
  if (src == null) return placeholderImagePath;

  const trimmed = String(src).trim();
  if (!trimmed) return placeholderImagePath;

  if (/^https?:\/\//i.test(trimmed)) {
    return pathnameFromAbsoluteUrl(trimmed);
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** 拼接为完整可访问 URL（购物车缓存、富文本等） */
export function resolveImageUrl(src?: string | null): string {
  const path = toRelativeImagePath(src);
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

export function resolveImageUrlList(urls: string[]): string[] {
  return urls.map((u) => resolveImageUrl(u));
}

export function toRelativeImagePathList(urls: string[]): string[] {
  return urls.map((u) => toRelativeImagePath(u));
}

/** 富文本 HTML 内相对 /uploads 路径补全为绝对地址 */
export function rewriteRichTextImageSrc(html: string): string {
  if (!html || typeof html !== 'string') return html;

  const base = baseUrl.replace(/\/+$/, '');

  return html.replace(
    /(src=["'])(\/uploads\/[^"']+)(["'])/gi,
    (_match, prefix: string, path: string, suffix: string) =>
      `${prefix}${base}${path}${suffix}`
  );
}
