/**
 * DeepSeek API 客户端（官方 OpenAI SDK）
 * 多模态图片：content 为 JSON 字符串，格式参考
 * https://blog.csdn.net/gang544043963/article/details/148040058
 *
 * [{"type":"text","text":"..."},{"type":"image","image":{"data":"<base64>","format":"base64"}}]
 */

import OpenAI, { APIError } from "openai";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";

export type DeepSeekContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string | DeepSeekContentPart[];
};

export type DeepSeekChatOptions = {
  messages: DeepSeekMessage[];
  temperature?: number;
  jsonMode?: boolean;
  /** V4 默认开启 thinking，结构化 JSON 任务建议关闭 */
  thinkingDisabled?: boolean;
  model?: string;
};

/** DeepSeek V4 扩展参数（OpenAI SDK 类型尚未收录） */
type DeepSeekChatCompletionParams =
  OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
    thinking?: { type: "disabled" | "enabled" };
  };

type BlogTextPart = { type: "text"; text: string };
type BlogImagePart = {
  type: "image";
  image: { data: string; format: "base64" };
};

let client: OpenAI | null = null;

function resolveBaseUrl(): string {
  const raw =
    process.env.DEEPSEEK_BASE_URL ??
    process.env.DEEPSEEK_API_URL ??
    DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function resolveModel(override?: string): string {
  return (
    override ??
    process.env.DEEPSEEK_MODEL ??
    process.env.DEEPSEEK_VISION_MODEL ??
    DEFAULT_MODEL
  );
}

function resolveApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
  if (!key) {
    throw new Error("DeepSeek API Key 未配置，请在 .env 中设置 DEEPSEEK_API_KEY");
  }
  return key;
}

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: resolveBaseUrl(),
      apiKey: resolveApiKey(),
    });
  }
  return client;
}

function stripBase64Prefix(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, "");
}

/** 将内部消息转为 DeepSeek 多模态 JSON 字符串 content */
function encodeMessageContent(content: string | DeepSeekContentPart[]): string {
  if (typeof content === "string") return content;

  const hasImage = content.some((part) => part.type === "image_url");
  if (!hasImage) {
    return content
      .filter((part): part is BlogTextPart => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }

  const blogParts: Array<BlogTextPart | BlogImagePart> = content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    const raw = stripBase64Prefix(part.image_url.url);
    return {
      type: "image",
      image: { data: raw, format: "base64" as const },
    };
  });

  return JSON.stringify(blogParts);
}

function normalizeMessages(
  messages: DeepSeekMessage[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: encodeMessageContent(message.content),
  }));
}

function extractJsonBlock(text: string): string {
  const trimmed = text.trim();

  // ```json ... ``` or ``` ... ``` (anywhere in response)
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  // Raw JSON object embedded in surrounding prose / thinking leakage
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0].trim();

  // Fallback: JSON array
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0].trim();

  return trimmed;
}

function formatApiError(err: APIError): string {
  const detail =
    typeof err.error === "object" &&
    err.error !== null &&
    "message" in err.error &&
    typeof err.error.message === "string"
      ? err.error.message
      : err.message;
  return `DeepSeek 调用失败 (${err.status})：${detail}`;
}

function extractAssistantText(completion: OpenAI.Chat.ChatCompletion): string {
  const message = completion.choices?.[0]?.message;
  const content = message?.content?.trim();
  if (content) return content;

  const reasoning = (
    message as OpenAI.Chat.ChatCompletionMessage & {
      reasoning_content?: string | null;
    }
  )?.reasoning_content?.trim();
  if (reasoning) return reasoning;

  const reason = completion.choices?.[0]?.finish_reason ?? "unknown";
  throw new Error(`DeepSeek 返回空内容（finish_reason=${reason}）`);
}

/** 调用 DeepSeek chat/completions，返回 assistant 文本 */
export async function deepseekChat(
  options: DeepSeekChatOptions
): Promise<string> {
  const params: DeepSeekChatCompletionParams = {
    model: resolveModel(options.model),
    messages: normalizeMessages(options.messages),
    temperature: options.temperature ?? 0.2,
    stream: false,
    thinking: {
      type: options.thinkingDisabled !== false ? "disabled" : "enabled",
    },
  };

  if (options.jsonMode) {
    params.response_format = { type: "json_object" };
  }

  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await getClient().chat.completions.create(params);
  } catch (err) {
    if (err instanceof APIError) {
      throw new Error(formatApiError(err));
    }
    throw err;
  }

  return extractAssistantText(completion);
}

/** JSON 模式对话，自动解析并解码 Unicode 转义 */
export async function deepseekJsonChat<T>(
  options: Omit<DeepSeekChatOptions, "jsonMode">
): Promise<T> {
  const text = await deepseekChat({ ...options, jsonMode: true });
  const cleaned = extractJsonBlock(text);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error("DeepSeek 返回非 JSON 格式，请重试");
  }
}

export function imageUserMessage(
  base64: string,
  mimeType: string,
  prompt: string
): DeepSeekMessage {
  const raw = stripBase64Prefix(base64);
  return {
    role: "user",
    content: JSON.stringify([
      { type: "text", text: prompt },
      {
        type: "image",
        image: { data: raw, format: "base64" },
      },
    ] satisfies Array<BlogTextPart | BlogImagePart>),
  };
}

export { DEFAULT_MODEL, DEFAULT_BASE_URL };
