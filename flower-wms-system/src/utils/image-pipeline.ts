"use client";

const MAX_WIDTH = 1100;
const JPEG_QUALITY = 0.85;
const DEDUP_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { hash: string; at: number };
const uploadDedupCache = new Map<string, CacheEntry>();

function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export async function compressImageFile(
  file: File,
  maxWidth = MAX_WIDTH,
  quality = JPEG_QUALITY
) {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("图片解码失败"));
    el.src = dataUrl;
  });

  const scale = img.width > maxWidth ? maxWidth / img.width : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 不可用");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("图片压缩失败"))),
      "image/jpeg",
      quality
    );
  });

  const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = compressedDataUrl.split(",")[1] ?? "";
  const md5 = djb2Hash(base64);

  return { blob, base64, md5, mimeType: "image/jpeg", dataUrl: compressedDataUrl };
}

export function assertNotDuplicateUpload(md5: string): void {
  const now = Date.now();
  for (const [key, entry] of uploadDedupCache) {
    if (now - entry.at > DEDUP_TTL_MS) uploadDedupCache.delete(key);
  }
  const hit = uploadDedupCache.get(md5);
  if (hit && now - hit.at < DEDUP_TTL_MS) {
    throw new Error("相同图片 5 分钟内已上传，请勿重复提交");
  }
  uploadDedupCache.set(md5, { hash: md5, at: now });
}

export async function prepareImageForUpload(file: File) {
  const compressed = await compressImageFile(file);
  assertNotDuplicateUpload(compressed.md5);
  return compressed;
}
