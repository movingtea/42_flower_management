import { pinyin } from "pinyin-pro";

/** 中文名 → 拼音首字母简拼，如「矢车菊」→ scj、「洛神玫瑰」→ lsmg */
export function toPinyinIndex(chineseName: string): string {
  const trimmed = chineseName.trim();
  if (!trimmed) return "";

  const raw = pinyin(trimmed, {
    pattern: "first",
    toneType: "none",
    type: "array",
  });

  return raw
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
