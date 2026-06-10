/**
 * 纯函数单测 — 运行：npm run test:cms-pickers
 */
import assert from "node:assert/strict";
import type { BannerWriteItem } from "./banner";
import { bannerToLinkTarget, linkTargetToBannerFields } from "./cms-link-target";

const productItem: BannerWriteItem = {
  imageUrl: "x",
  sortOrder: 1,
  targetType: "PRODUCT",
  productId: "prod-1",
  targetParam: null,
};
const productTarget = bannerToLinkTarget(productItem);
assert.equal(productTarget.targetType, "PRODUCT");
assert.equal(productTarget.productId, "prod-1");
const productFields = linkTargetToBannerFields(productTarget);
assert.equal(productFields.targetType, "PRODUCT");
assert.equal(productFields.productId, "prod-1");

const sceneItem: BannerWriteItem = {
  imageUrl: "x",
  sortOrder: 1,
  targetType: "ACTIVITY",
  targetParam: "/pages/category/category?sceneType=BIRTHDAY",
  productId: null,
};
const sceneTarget = bannerToLinkTarget(sceneItem);
assert.equal(sceneTarget.targetType, "SCENE");
assert.equal(sceneTarget.sceneType, "BIRTHDAY");

const customItem: BannerWriteItem = {
  imageUrl: "x",
  sortOrder: 1,
  targetType: "ACTIVITY",
  targetParam: "/pages/activity/spring",
  productId: null,
};
const customTarget = bannerToLinkTarget(customItem);
assert.equal(customTarget.targetType, "CUSTOM_URL");
assert.equal(customTarget.customUrl, "/pages/activity/spring");

console.log("cms-link-target tests passed");
