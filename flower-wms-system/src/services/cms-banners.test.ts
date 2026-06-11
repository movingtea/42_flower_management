/**
 * Run: npm run test:cms-banners
 */
import assert from "node:assert/strict";
import { resolveBannerCmsStatus } from "@/services/banner-rules-pure";

function testListFilterSemantics() {
  assert.equal(
    resolveBannerCmsStatus({
      isActive: false,
      isDeleted: true,
    }),
    "已删除"
  );
  assert.equal(
    resolveBannerCmsStatus({
      isActive: false,
      isDeleted: false,
    }),
    "已停用"
  );
  assert.notEqual(
    resolveBannerCmsStatus({ isActive: false, isDeleted: false }),
    resolveBannerCmsStatus({ isActive: false, isDeleted: true })
  );
}

function testInactiveNotSameAsDeleted() {
  const inactive = resolveBannerCmsStatus({
    isActive: false,
    isDeleted: false,
  });
  const deleted = resolveBannerCmsStatus({
    isActive: false,
    isDeleted: true,
  });
  assert.equal(inactive, "已停用");
  assert.equal(deleted, "已删除");
}

function run() {
  testListFilterSemantics();
  testInactiveNotSameAsDeleted();
  console.log("cms-banners.test.ts: all tests passed");
}

run();
