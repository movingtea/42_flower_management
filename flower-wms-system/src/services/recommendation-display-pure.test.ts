/**
 * Run: npm run test:recommendation-display
 */
import assert from "node:assert/strict";
import { evaluateRecommendationItemDisplayStatus } from "./recommendation-display-pure";

function testVisible() {
  const result = evaluateRecommendationItemDisplayStatus({
    isActive: true,
    product: {
      isActive: true,
      skus: [{ stock: 3, imageUrl: "https://cdn.example.com/a.jpg" }],
    },
  });
  assert.equal(result.status, "VISIBLE");
  assert.equal(result.visibleOnMiniprogram, true);
}

function testSoldOut() {
  const result = evaluateRecommendationItemDisplayStatus({
    isActive: true,
    product: {
      isActive: true,
      skus: [{ stock: 0, imageUrl: "https://cdn.example.com/a.jpg" }],
    },
  });
  assert.equal(result.status, "PRODUCT_SOLD_OUT");
  assert.match(result.label, /售罄/);
}

function testOffShelf() {
  const result = evaluateRecommendationItemDisplayStatus({
    isActive: true,
    product: {
      isActive: false,
      skus: [{ stock: 5, imageUrl: "https://cdn.example.com/a.jpg" }],
    },
  });
  assert.equal(result.status, "PRODUCT_OFF_SHELF");
}

function testMissingImage() {
  const result = evaluateRecommendationItemDisplayStatus({
    isActive: true,
    product: {
      isActive: true,
      skus: [{ stock: 2, imageUrl: null }],
    },
  });
  assert.equal(result.status, "MISSING_MAIN_IMAGE");
}

function main() {
  testVisible();
  testSoldOut();
  testOffShelf();
  testMissingImage();
  console.log("recommendation-display-pure.test.ts: all tests passed");
}

main();
