/**
 * Run: npm run test:upload-validation
 */
import assert from "node:assert/strict";
import { getStorageConfig } from "@/lib/storage/config";
import { StorageError } from "@/lib/storage/errors";
import { validateImageUpload } from "@/lib/storage/upload-validation";

const config = {
  ...getStorageConfig(),
  uploadMaxSizeMb: 3,
  uploadAllowSvg: false,
};

async function testSvgRejected() {
  const file = new File(["<svg></svg>"], "test.svg", {
    type: "image/svg+xml",
  });
  await assert.rejects(
    () => validateImageUpload(file, config),
    (err: unknown) => err instanceof StorageError && err.code === "INVALID_FILE_TYPE"
  );
}

async function testFileTooLarge() {
  const big = new Uint8Array(4 * 1024 * 1024);
  const file = new File([big], "big.jpg", { type: "image/jpeg" });
  await assert.rejects(
    () => validateImageUpload(file, config),
    (err: unknown) => err instanceof StorageError && err.code === "FILE_TOO_LARGE"
  );
}

async function testValidJpeg() {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "a.jpg", {
    type: "image/jpeg",
  });
  const result = await validateImageUpload(file, config);
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(result.extension, "jpg");
}

async function test173MbPasses() {
  const sizeBytes = Math.floor(1.73 * 1024 * 1024);
  const file = new File([new Uint8Array(sizeBytes)], "banner.jpg", {
    type: "image/jpeg",
  });
  const result = await validateImageUpload(file, config);
  assert.equal(result.size, sizeBytes);
  assert.equal(result.mimeType, "image/jpeg");
}

async function testExactly3MbPasses() {
  const sizeBytes = 3 * 1024 * 1024;
  const file = new File([new Uint8Array(sizeBytes)], "edge.jpg", {
    type: "image/jpeg",
  });
  const result = await validateImageUpload(file, config);
  assert.equal(result.size, sizeBytes);
}

async function testEmptyFile() {
  const file = new File([], "empty.jpg", { type: "image/jpeg" });
  await assert.rejects(
    () => validateImageUpload(file, config),
    (err: unknown) => err instanceof StorageError && err.code === "FILE_REQUIRED"
  );
}

async function run() {
  await testSvgRejected();
  await testFileTooLarge();
  await testValidJpeg();
  await test173MbPasses();
  await testExactly3MbPasses();
  await testEmptyFile();
  console.log("upload-validation.test.ts: all tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
