/**
 * Run: npm run test:miniprogram-image-url (from flower-wms-system)
 * or: node scripts/test-image-url.mjs (from 42_mp)
 */

const OSS_PUBLIC = 'https://oss.universe42.studio';
const OSS_PREFIX = 'universe42';
const SITE_BASE = 'https://www.universe42.studio';
const PLACEHOLDER = '/images/product-placeholder.svg';

function trimBase(value) {
  return value.replace(/\/+$/, '');
}

function isAbsoluteHttpUrl(value) {
  return /^https?:\/\//i.test(value.trim());
}

function isLegacyUploadPath(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('/uploads/')) return true;
  if (/^uploads\//i.test(trimmed)) return true;
  if (/localhost|127\.0\.0\.1/i.test(trimmed) && trimmed.includes('/uploads/')) {
    return true;
  }
  return false;
}

function isInvalidRemoteImage(value) {
  if (/localhost|127\.0\.0\.1/i.test(value)) return true;
  return isLegacyUploadPath(value);
}

function isOssObjectKey(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('/')) return false;
  if (trimmed.includes('..') || isAbsoluteHttpUrl(trimmed)) return false;
  if (/localhost/i.test(trimmed)) return false;
  return trimmed.startsWith(`${OSS_PREFIX}/`);
}

function isPublicOssUrl(value) {
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  const base = trimBase(OSS_PUBLIC);
  return trimmed === base || trimmed.startsWith(`${base}/`);
}

function isLocalMiniProgramAsset(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('/images/')) return true;
  if (trimmed.startsWith('/assets/')) return true;
  if (/^\.\.\/\.\.\/assets\//.test(trimmed)) return true;
  if (/^assets\//.test(trimmed)) return true;
  if (trimmed.startsWith('wxfile://')) return true;
  return false;
}

function resolveSiteAssetUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${trimBase(SITE_BASE)}${normalized}`;
}

function objectKeyToPublicUrl(objectKey) {
  return `${trimBase(OSS_PUBLIC)}/${objectKey.replace(/^\/+/, '')}`;
}

function normalizeImageUrl(src) {
  if (src == null) return resolveSiteAssetUrl(PLACEHOLDER);
  const trimmed = String(src).trim();
  if (!trimmed) return resolveSiteAssetUrl(PLACEHOLDER);

  if (isLocalMiniProgramAsset(trimmed)) {
    return trimmed.startsWith('/') ? resolveSiteAssetUrl(trimmed) : trimmed;
  }

  if (isInvalidRemoteImage(trimmed)) {
    return resolveSiteAssetUrl(PLACEHOLDER);
  }

  if (isPublicOssUrl(trimmed)) {
    return trimBase(trimmed) === trimBase(OSS_PUBLIC)
      ? resolveSiteAssetUrl(PLACEHOLDER)
      : trimmed;
  }

  if (isAbsoluteHttpUrl(trimmed)) return trimmed;

  if (isOssObjectKey(trimmed)) return objectKeyToPublicUrl(trimmed);

  const slashKey = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  if (isOssObjectKey(slashKey)) return objectKeyToPublicUrl(slashKey);

  if (trimmed.startsWith('/')) return resolveSiteAssetUrl(trimmed);

  return resolveSiteAssetUrl(PLACEHOLDER);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

const OBJECT_KEY = `${OSS_PREFIX}/products/sku/a.webp`;
const OSS_URL = `${OSS_PUBLIC}/${OBJECT_KEY}`;

assertEqual(
  normalizeImageUrl(OSS_URL),
  OSS_URL,
  'public OSS URL passthrough'
);

assertEqual(
  normalizeImageUrl(OBJECT_KEY),
  OSS_URL,
  'objectKey to OSS public URL'
);

assertEqual(
  normalizeImageUrl('http://localhost:3000/uploads/a.webp'),
  resolveSiteAssetUrl(PLACEHOLDER),
  'localhost invalid'
);

assertEqual(
  normalizeImageUrl('/uploads/a.webp'),
  resolveSiteAssetUrl(PLACEHOLDER),
  'legacy uploads invalid'
);

assertEqual(
  normalizeImageUrl('/assets/icons/gift.png'),
  resolveSiteAssetUrl('/assets/icons/gift.png'),
  'local /assets path'
);

assertEqual(
  normalizeImageUrl('../../assets/icons/gift.png'),
  '../../assets/icons/gift.png',
  'relative assets path'
);

assertEqual(
  normalizeImageUrl(''),
  resolveSiteAssetUrl(PLACEHOLDER),
  'empty string'
);

assertEqual(
  normalizeImageUrl(null),
  resolveSiteAssetUrl(PLACEHOLDER),
  'null'
);

const wrongSite = normalizeImageUrl(OBJECT_KEY);
assertEqual(wrongSite.includes('www.universe42.studio/universe42'), false, 'no www site OSS path');
assertEqual(wrongSite.startsWith('/'), false, 'not site-relative path');

console.log('test-image-url.mjs: all passed');
