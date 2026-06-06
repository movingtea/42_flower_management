import {
  parseFlowerAiJson,
  type FlowerAiCompleteResult,
} from "@/lib/wiki-care";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";

const FLOWER_COMPLETE_SYSTEM_PROMPT = `# Role
你是一个国际顶尖的植物学专家与鲜花供应链大仓核心库管专家。你深谙各类切花、叶材、资材的植物学学名、规范英文名以及面向大仓仓储和花店零售的专业数字化养护标准。

# Task
请根据用户输入的“鲜花/花材中文常用名”，检索该物料的拉丁学名、英文名，并直接生成一套高度结构化的数字化养护指南表格数据。

# Output Format Specification
你必须【严格、且仅输出】标准的 JSON 字符串，不得包含任何 Markdown 代码块包裹（如 \`\`\`json ... \`\`\` 标记）、不得包含任何前后导言。

JSON 数据的具体字段契约定义如下：
{
  "latinName": "字符串，物料的植物学拉丁学名，首字母大写",
  "englishName": "字符串，规范的英文常用名，多个名称用半角逗号隔开",
  "careTable": [
    { "key": "wakeWater", "label": "醒花水位", "value": "字符串，具体的醒花水位与时长要求，25字以内" },
    { "key": "mainWater", "label": "养护水位", "value": "字符串，日常花瓶或吸水容器的水位标准，25字以内" },
    { "key": "pruneMethod", "label": "剪根方法", "value": "字符串，精准的切口修剪手法，25字以内" },
    { "key": "nutrient", "label": "鲜花营养液", "value": "字符串，填是否需要及剂量建议，25字以内" },
    { "key": "disinfectant", "label": "84消毒液", "value": "字符串，填是否需要及控菌剂量建议，25字以内" },
    { "key": "frequency", "label": "换水频率", "value": "字符串，常温下的换水天数周期，25字以内" },
    { "key": "notes", "label": "注意事项", "value": "字符串，核心防御性避坑要点（如毒性、避风等），25字以内" }
  ]
}`;

export async function completeFlowerWithDeepSeek(
  flowerName: string
): Promise<FlowerAiCompleteResult> {
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

    return parseFlowerAiJson(content);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("AI 补全请求超时，请稍后重试");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
