import {
  WMS_BOTANICAL_VISION_SYSTEM_PROMPT,
  WMS_BOUQUET_DECOMPOSE_USER_PROMPT,
  WMS_SINGLE_FLOWER_USER_PROMPT,
  WMS_WIKI_IMAGE_USER_PROMPT,
} from "@/lib/ai-prompts";
import {
  deepseekJsonChat,
  imageUserMessage,
} from "@/lib/deepseek-client";
import {
  parseFloralRole,
  type BouquetDraftLine,
  type WikiAiFields,
} from "@/lib/wiki-constants";

export type FloralIngredientPreview = {
  englishName: string;
  name: string;
  possibleAmount: number;
  color: string;
};

export type FloralVisionResult = {
  isSuccess: boolean;
  ingredients: FloralIngredientPreview[];
};

function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

function sanitizeText(value: unknown): string {
  if (value == null) return "";
  return decodeUnicodeEscapes(String(value)).trim();
}

function sanitizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(sanitizeText).filter(Boolean))];
  }
  const single = sanitizeText(raw);
  return single ? [single] : [];
}

function sanitizeAmount(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function normalizeIngredient(raw: Record<string, unknown>): FloralIngredientPreview | null {
  const englishName = sanitizeText(raw.englishName);
  if (!englishName) return null;
  return {
    englishName,
    name: sanitizeText(raw.name ?? raw.chineseName) || englishName,
    possibleAmount: sanitizeAmount(raw.possibleAmount ?? raw.quantity),
    color: sanitizeText(raw.color),
  };
}

/** 核心视觉审计：品类辨识 + 物理计数 */
export async function analyzeFloralImage(
  base64: string,
  mimeType = "image/jpeg",
  userPrompt = WMS_BOUQUET_DECOMPOSE_USER_PROMPT
): Promise<FloralVisionResult> {
  const data = await deepseekJsonChat<Record<string, unknown>>({
    messages: [
      { role: "system", content: WMS_BOTANICAL_VISION_SYSTEM_PROMPT },
      imageUserMessage(base64, mimeType, userPrompt),
    ],
    temperature: 0.1,
    thinkingDisabled: true,
  });

  const rawList = data.ingredients ?? data.lines;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new Error("AI 未能识别有效花材");
  }

  const ingredients = rawList
    .map((item) =>
      typeof item === "object" && item !== null
        ? normalizeIngredient(item as Record<string, unknown>)
        : null
    )
    .filter((item): item is FloralIngredientPreview => item !== null);

  if (ingredients.length === 0) {
    throw new Error("AI 未能识别有效花材");
  }

  return {
    isSuccess: data.isSuccess !== false,
    ingredients,
  };
}

/** 单花材识别 → 拉丁/英文名 */
export async function identifyFlowerLatinName(
  base64: string,
  mimeType = "image/jpeg"
): Promise<{ englishName: string; chineseName?: string }> {
  const { ingredients } = await analyzeFloralImage(
    base64,
    mimeType,
    WMS_SINGLE_FLOWER_USER_PROMPT
  );

  const primary = ingredients[0];
  return {
    englishName: primary.englishName,
    chineseName: primary.name || undefined,
  };
}

/** AI 脑补完整 Wiki 字段（纯文本，无图片） */
export async function brainfillWikiFields(
  englishName: string
): Promise<WikiAiFields> {
  const data = await deepseekJsonChat<Record<string, unknown>>({
    messages: [
      {
        role: "system",
        content:
          'You are a digital floral supply chain expert. Return raw JSON ONLY (no markdown): {"englishName":"","chineseName":"","colorTags":[],"morphology":"","supplySeason":"","floralRole":"主花|配花|线条花|叶材","maintenance":"three-section care guide","suggestedAliases":[]}. Use normal Chinese characters, not unicode escapes.',
      },
      {
        role: "user",
        content: `Generate a complete material profile for "${englishName}". Output raw JSON only.`,
      },
    ],
    temperature: 0.2,
    thinkingDisabled: true,
  });

  const en = sanitizeText(data.englishName) || englishName;
  return {
    englishName: en,
    chineseName: sanitizeText(data.chineseName) || en,
    colorTags: sanitizeTags(data.colorTags ?? data.color),
    morphology: sanitizeText(data.morphology ?? data.texture),
    supplySeason: sanitizeText(data.supplySeason ?? data.availability) || "全年",
    floralRole: parseFloralRole(data.floralRole ?? data.role),
    maintenance: sanitizeText(data.maintenance),
    suggestedAliases: sanitizeTags(data.suggestedAliases),
  };
}

/** 从图片一步生成 Wiki 字段（视觉识别 + 文本脑补） */
export async function generateWikiFromImage(
  base64: string,
  mimeType = "image/jpeg"
): Promise<WikiAiFields> {
  const { ingredients } = await analyzeFloralImage(
    base64,
    mimeType,
    WMS_WIKI_IMAGE_USER_PROMPT
  );
  const primary = ingredients[0];

  const draft = await brainfillWikiFields(primary.englishName);
  return {
    ...draft,
    englishName: primary.englishName,
    chineseName: primary.name || draft.chineseName,
    colorTags: primary.color
      ? [...new Set([primary.color, ...draft.colorTags])]
      : draft.colorTags,
  };
}

/** 复合花束拆解 → 内存草稿（不落库） */
export async function decomposeBouquetImage(
  base64: string,
  mimeType = "image/jpeg"
): Promise<Omit<BouquetDraftLine, "key">[]> {
  const { ingredients } = await analyzeFloralImage(
    base64,
    mimeType,
    WMS_BOUQUET_DECOMPOSE_USER_PROMPT
  );

  return ingredients.map((item) => ({
    englishName: item.englishName,
    chineseName: item.name,
    quantity: item.possibleAmount,
    floralRole: inferFloralRoleFromCount(item.possibleAmount, ingredients.length),
  }));
}

function inferFloralRoleFromCount(amount: number, totalTypes: number) {
  if (totalTypes === 1) return parseFloralRole("主花");
  if (amount >= 5) return parseFloralRole("配花");
  if (amount === 1) return parseFloralRole("线条花");
  return parseFloralRole("配花");
}

export async function generateWikiFromImageBuffer(
  buffer: Buffer,
  mimeType: string
) {
  return generateWikiFromImage(buffer.toString("base64"), mimeType);
}

export async function generateWikiFromBase64(
  base64: string,
  mimeType = "image/jpeg"
) {
  const cleaned = base64.replace(/^data:[^;]+;base64,/, "");
  return generateWikiFromImage(cleaned, mimeType);
}

export async function decomposeBouquetFromBase64(
  base64: string,
  mimeType = "image/jpeg"
) {
  const cleaned = base64.replace(/^data:[^;]+;base64,/, "");
  return decomposeBouquetImage(cleaned, mimeType);
}
