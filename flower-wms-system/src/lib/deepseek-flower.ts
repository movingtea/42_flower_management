import {
  parseFlowerAiJson,
  type FlowerAiCompleteResult,
} from "@/lib/wiki-care";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";

/** Flower roles understood by the V2 material master (`FloralRole` enum). */
export const FLOWER_AI_FLORAL_ROLES = ["MAIN", "FILLER", "LINE", "FOLIAGE"] as const;
export type FlowerAiFloralRole = (typeof FLOWER_AI_FLORAL_ROLES)[number];

/** Optional material-library parity fields returned next to the V1 contract. */
export type FlowerAiKnowledgeFields = {
  colorTags: string[];
  morphology: string | null;
  supplySeason: string | null;
  floralRole: FlowerAiFloralRole | null;
  suggestedAliases: string[];
};

/**
 * Backward-compatible superset of `FlowerAiCompleteResult`: the V1 wiki contract
 * stays authoritative, the parity fields are additive and may be empty.
 */
export type FlowerAiKnowledgeResult = FlowerAiCompleteResult & FlowerAiKnowledgeFields;

const MAX_AI_COLOR_TAGS = 6;
const MAX_AI_ALIASES = 8;
const MAX_AI_KNOWLEDGE_LENGTH = 120;
const MAX_AI_SHORT_TEXT_LENGTH = 20;

const FLOWER_COMPLETE_SYSTEM_PROMPT = `# Role
你是一个国际顶尖的植物学专家与鲜花供应链大仓核心库管专家。你深谙各类切花、叶材、资材的植物学学名、规范英文名，以及面向花店日常操作的简短养护标注。

# Task
请根据用户输入的“鲜花/花材中文常用名”，检索该物料的拉丁学名、英文名，生成一句适合花店物料百科展示的中文花语，并生成一套高度结构化的数字化养护指南表格数据；同时补充颜色标签、形态特征、供货周期、花材角色与常见中文别名，供物料母表直接落库。

# Output Format Specification
你必须【严格、且仅输出】标准的 JSON 字符串，不得包含任何 Markdown 代码块包裹（如 \`\`\`json ... \`\`\` 标记）、不得包含任何前后导言。

JSON 数据的具体字段契约定义如下：
{
  "latinName": "字符串，物料的植物学拉丁学名，首字母大写",
  "englishName": "字符串，规范的英文常用名，多个名称用半角逗号隔开",
  "flowerLanguage": "字符串，中文花语/寓意，简洁优雅，35字以内",
  "colorTags": ["字符串数组，0-4 个该花材最常见的颜色标签，每个不超过 6 字，如：红色、香槟色"],
  "morphology": "字符串，一句话描述花型、花瓣、枝茎等形态特征，60字以内",
  "supplySeason": "字符串，常见供货周期，如：全年、4-9月",
  "floralRole": "字符串，必须是 MAIN、FILLER、LINE、FOLIAGE 之一：主花/配花/线状花/叶材",
  "suggestedAliases": ["字符串数组，2-6 个常见中文别名或俗称，每个不超过 20 字，如：月季"],
  "careTable": [
    { "key": "wakeWater", "label": "醒花水位", "value": "仅允许以下二选一，不得输出原因、步骤或解释：需要深水醒花 | 不需要深水醒花" },
    { "key": "mainWater", "label": "养护水位", "value": "仅返回具体水位短说明，15字以内，如：花瓶1/3至1/2、花瓶1/2、花瓶2/3。禁止长句、禁止解释原因" },
    { "key": "pruneMethod", "label": "剪根方法", "value": "仅允许以下三选一，不得输出长段说明：45度斜切 | 45度斜切 + 十字劈开 | 45度斜切，无需十字劈开" },
    { "key": "nutrient", "label": "鲜花营养液", "value": "仅允许以下二选一，不得输出句子：✓ | ✗" },
    { "key": "disinfectant", "label": "84消毒液", "value": "仅允许以下四选一，不得输出解释性文字：✓，1L水加1-2滴 | ✓，1L水加1滴 | ✓，2L水加1-2滴 | ✗" },
    { "key": "frequency", "label": "换水频率", "value": "字符串，常温下的换水天数周期，25字以内" },
    { "key": "notes", "label": "注意事项", "value": "字符串，核心防御性避坑要点（如毒性、避风等），25字以内" }
  ]
}

# Care Table Rules (Mandatory)
养护指南前 5 个字段必须是短文本或符号，禁止长句、禁止段落、禁止解释原因、禁止操作步骤、禁止额外建议。
错误示例：这种花材对水质较敏感，建议在醒花时使用深水，并保持水质清洁……
正确示例：需要深水醒花、花瓶1/3至1/2、45度斜切 + 十字劈开、✓、✓，1L水加1-2滴

# Optional Parity Fields
colorTags、morphology、supplySeason、floralRole、suggestedAliases 是给物料母表补充的字段：
- 不确定时返回空数组、空字符串或直接省略，不要编造；
- colorTags 只放颜色词，不要放等级、规格或花语；
- floralRole 只能是 MAIN、FILLER、LINE、FOLIAGE 四个大写英文值；
- suggestedAliases 只放中文俗称/别名，不要重复输入的花材名本身。`;

function stripJsonFence(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
}

function readAiText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function readAiList(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const entries: string[] = [];
  for (const item of value) {
    const text = readAiText(item, maxLength);
    if (!text || entries.includes(text)) continue;
    entries.push(text);
    if (entries.length >= limit) break;
  }
  return entries;
}

function readAiFloralRole(value: unknown): FlowerAiFloralRole | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toUpperCase();
  return (FLOWER_AI_FLORAL_ROLES as readonly string[]).includes(role)
    ? (role as FlowerAiFloralRole)
    : null;
}

/**
 * Parses the additive material-library fields. It is deliberately independent of
 * `parseFlowerAiJson`: a missing or malformed extra field must never break the V1
 * wiki contract, it only yields an empty value.
 */
export function parseFlowerAiKnowledgeFields(
  raw: string,
): FlowerAiKnowledgeFields {
  const empty: FlowerAiKnowledgeFields = {
    colorTags: [],
    morphology: null,
    supplySeason: null,
    floralRole: null,
    suggestedAliases: [],
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
  const data = parsed as Record<string, unknown>;
  return {
    colorTags: readAiList(data.colorTags, MAX_AI_COLOR_TAGS, MAX_AI_SHORT_TEXT_LENGTH),
    morphology: readAiText(data.morphology, MAX_AI_KNOWLEDGE_LENGTH),
    supplySeason: readAiText(data.supplySeason, MAX_AI_SHORT_TEXT_LENGTH),
    floralRole: readAiFloralRole(data.floralRole),
    suggestedAliases: readAiList(data.suggestedAliases, MAX_AI_ALIASES, MAX_AI_SHORT_TEXT_LENGTH),
  };
}

export async function completeFlowerWithDeepSeek(
  flowerName: string
): Promise<FlowerAiKnowledgeResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("未配置 DEEPSEEK_API_KEY，无法调用 AI 补全");
  }

  const model =
    process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetch(DEEPSEEK_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: FLOWER_COMPLETE_SYSTEM_PROMPT },
          {
            role: "user",
            content: `花材中文常用名：${flowerName.trim()}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `DeepSeek 请求失败 (${res.status})${errText ? `: ${errText.slice(0, 200)}` : ""}`
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("DeepSeek 返回内容为空");
    }

    // The V1 wiki contract is validated first; the parity fields are additive.
    return {
      ...parseFlowerAiJson(content),
      ...parseFlowerAiKnowledgeFields(content),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("AI 补全请求超时，请稍后重试");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
