/**
 * CMS 商品小程序预览图片 smoke
 * Run: npm run smoke:cms-product-preview
 */
import assert from "node:assert/strict";
import { getClientPreviewImageUrl, isClientImageInvalid } from "../src/lib/client-image-preview";

process.env.NEXT_PUBLIC_OSS_PUBLIC_BASE_URL = "https://oss.universe42.studio";
process.env.NEXT_PUBLIC_OSS_OBJECT_PREFIX = "universe42";

const OBJECT_KEY =
  "universe42/products/spu/2026/06/preview-card.webp";

function pickCoverUrl(skus: Array<{ imageUrl: string; isMainImage: boolean }>) {
  const withImage = (s: (typeof skus)[0]) => {
    const url = s.imageUrl?.trim();
    if (!url || isClientImageInvalid(url)) return false;
    return Boolean(getClientPreviewImageUrl(url));
  };
  const main =
    skus.find((s) => s.isMainImage && withImage(s)) ??
    skus.find(withImage) ??
    skus[0];
  return getClientPreviewImageUrl(main?.imageUrl ?? "");
}

function testPreviewUsesOssPublicUrl() {
  const url = pickCoverUrl([
    { imageUrl: OBJECT_KEY, isMainImage: true },
  ]);
  assert.ok(url?.includes("oss.universe42.studio"));
  assert.ok(url?.endsWith(".webp"));
}

function testInvalidLocalhostHintPath() {
  const url = pickCoverUrl([
    { imageUrl: "http://localhost:3000/uploads/old.jpg", isMainImage: true },
  ]);
  assert.equal(url, null);
  assert.equal(
    isClientImageInvalid("http://localhost:3000/uploads/old.jpg"),
    true
  );
}

testPreviewUsesOssPublicUrl();
testInvalidLocalhostHintPath();

console.log("smoke:cms-product-preview passed");
