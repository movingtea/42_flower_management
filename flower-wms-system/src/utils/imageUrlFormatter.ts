/** 需要拼接为绝对 URL 的字符串字段名 */
const IMAGE_STRING_KEYS = new Set([
  "imageUrl",
  "coverImage",
  "thumbnail",
  "thumbUrl",
  "avatarUrl",
  "bannerUrl",
  "detailImage",
  "mainImage",
  "picUrl",
]);

/** 图片 URL 字符串数组字段名 */
const IMAGE_ARRAY_KEYS = new Set(["images", "imageList", "gallery"]);

/** 获取 API 对外基址（用于拼接 /uploads 等相对路径） */
export function getWechatApiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
}

/**
 * 将单条图片路径转为绝对 URL。
 * - 已是 http(s) 开头：原样返回
 * - 以 / 开头：拼接 NEXT_PUBLIC_API_URL（缺省为 http://localhost:3000）
 */
export function resolveImageUrl(
  value: string | null | undefined
): string | null | undefined {
  if (value == null) return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    return `${getWechatApiBaseUrl()}${trimmed}`;
  }

  return trimmed;
}

function formatImageArray(value: unknown): unknown {
  if (!Array.isArray(value)) return walkUnknown(value);
  return value.map((item) => {
    if (typeof item === "string") {
      return resolveImageUrl(item);
    }
    return walkUnknown(item);
  });
}

function walkUnknown(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => walkUnknown(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(record)) {
      if (IMAGE_ARRAY_KEYS.has(key)) {
        out[key] = formatImageArray(val);
        continue;
      }

      if (IMAGE_STRING_KEYS.has(key) && typeof val === "string") {
        out[key] = resolveImageUrl(val);
        continue;
      }

      out[key] = walkUnknown(val);
    }

    return out;
  }

  return value;
}

/**
 * 深度清洗 JSON 结构中的图片相对路径，供 /api/wechat/* 下发前使用。
 * 返回新对象，不修改入参引用。
 */
export function imageUrlFormatter<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  const cloned = JSON.parse(JSON.stringify(input)) as T;
  return walkUnknown(cloned) as T;
}
