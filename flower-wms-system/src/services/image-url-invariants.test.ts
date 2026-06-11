/**
 * Run: npm run test:image-url-invariants
 */
import assert from "node:assert/strict";
import {
  isLocalhostUrl,
  normalizeStoredImagePath,
  toPublicImageUrl,
} from "@/lib/image-url";

function testStoreRelativePath() {
  assert.equal(
    normalizeStoredImagePath("uploads/a.jpg"),
    "/uploads/a.jpg"
  );
}

function testDoNotStoreLocalhost() {
  assert.equal(
    normalizeStoredImagePath("http://localhost:3000/uploads/a.jpg"),
    "/uploads/a.jpg"
  );
}

function testHttpsUnchanged() {
  const url = "https://cdn.example.com/a.jpg";
  assert.equal(normalizeStoredImagePath(url), url);
}

function testPublicUrlNoLocalhost() {
  const publicUrl = toPublicImageUrl("/uploads/a.jpg");
  assert.ok(publicUrl);
  assert.equal(isLocalhostUrl(publicUrl!), false);
}

function testNoDoubleConcat() {
  const url = "https://cdn.example.com/a.jpg";
  assert.equal(toPublicImageUrl(url), url);
}

function run() {
  testStoreRelativePath();
  testDoNotStoreLocalhost();
  testHttpsUnchanged();
  testPublicUrlNoLocalhost();
  testNoDoubleConcat();
  console.log("image-url-invariants.test.ts: all tests passed");
}

run();
