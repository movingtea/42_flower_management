/**
 * 运行：npm run test:image-url
 */
import assert from "node:assert/strict";
import {
  isAbsoluteUrl,
  isLocalhostUrl,
  normalizeStoredImagePath,
  stripLocalDevOrigin,
  toPublicImageUrl,
} from "@/lib/image-url";

function testIsAbsoluteUrl() {
  assert.equal(isAbsoluteUrl("https://cdn.example.com/a.jpg"), true);
  assert.equal(isAbsoluteUrl("http://localhost:3000/uploads/a.jpg"), true);
  assert.equal(isAbsoluteUrl("/uploads/a.jpg"), false);
  assert.equal(isAbsoluteUrl("uploads/a.jpg"), false);
}

function testIsLocalhostUrl() {
  assert.equal(isLocalhostUrl("http://localhost:3000/uploads/a.jpg"), true);
  assert.equal(isLocalhostUrl("http://127.0.0.1:3000/uploads/a.jpg"), true);
  assert.equal(isLocalhostUrl("https://cdn.example.com/a.jpg"), false);
}

function testNormalizeStoredImagePath() {
  assert.equal(normalizeStoredImagePath("/uploads/a.jpg"), "/uploads/a.jpg");
  assert.equal(
    normalizeStoredImagePath("http://localhost:3000/uploads/a.jpg"),
    "/uploads/a.jpg"
  );
  assert.equal(
    normalizeStoredImagePath("http://127.0.0.1:3000/uploads/a.jpg"),
    "/uploads/a.jpg"
  );
  assert.equal(
    normalizeStoredImagePath("https://cdn.example.com/a.jpg"),
    "https://cdn.example.com/a.jpg"
  );
  assert.equal(normalizeStoredImagePath(null), null);
  assert.equal(normalizeStoredImagePath(""), null);
  assert.equal(normalizeStoredImagePath("  "), null);
  assert.equal(normalizeStoredImagePath("uploads/a.jpg"), "/uploads/a.jpg");
}

function testStripLocalDevOrigin() {
  assert.equal(
    stripLocalDevOrigin("http://localhost:3000/uploads/a.jpg"),
    "/uploads/a.jpg"
  );
  assert.equal(
    stripLocalDevOrigin("https://cdn.example.com/a.jpg"),
    "https://cdn.example.com/a.jpg"
  );
}

function testToPublicImageUrl() {
  const prevAsset = process.env.NEXT_PUBLIC_ASSET_BASE_URL;
  const prevApi = process.env.NEXT_PUBLIC_API_URL;
  delete process.env.NEXT_PUBLIC_ASSET_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_URL;

  try {
    assert.equal(toPublicImageUrl("/uploads/a.jpg"), "/uploads/a.jpg");
    assert.equal(
      toPublicImageUrl("http://localhost:3000/uploads/a.jpg"),
      "/uploads/a.jpg"
    );
    assert.equal(
      toPublicImageUrl("https://cdn.example.com/a.jpg"),
      "https://cdn.example.com/a.jpg"
    );
    assert.equal(toPublicImageUrl(null), null);
    assert.equal(toPublicImageUrl(""), null);

    process.env.NEXT_PUBLIC_ASSET_BASE_URL = "https://cdn.prod.example.com";
    assert.equal(
      toPublicImageUrl("/uploads/a.jpg"),
      "https://cdn.prod.example.com/uploads/a.jpg"
    );
    assert.equal(
      toPublicImageUrl("https://cdn.example.com/a.jpg"),
      "https://cdn.example.com/a.jpg"
    );
  } finally {
    if (prevAsset === undefined) delete process.env.NEXT_PUBLIC_ASSET_BASE_URL;
    else process.env.NEXT_PUBLIC_ASSET_BASE_URL = prevAsset;
    if (prevApi === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = prevApi;
  }
}

function testToPublicImageUrlNoDoubleAbsolute() {
  const input = "https://cdn.example.com/a.jpg";
  assert.equal(toPublicImageUrl(input), input);
  assert.equal(toPublicImageUrl(input)?.startsWith("https://https://"), false);
}

function run() {
  testIsAbsoluteUrl();
  testIsLocalhostUrl();
  testNormalizeStoredImagePath();
  testStripLocalDevOrigin();
  testToPublicImageUrl();
  testToPublicImageUrlNoDoubleAbsolute();
  console.log("image-url.test.ts: all passed");
}

run();
