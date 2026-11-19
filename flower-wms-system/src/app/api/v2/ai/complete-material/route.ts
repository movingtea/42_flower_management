import { NextResponse } from "next/server";
import { normalizeAiCareTable } from "@/lib/ai/material-care-normalizer";
import { completeFlowerWithDeepSeek } from "@/lib/deepseek-flower";
import {
  formatWikiEnglishName,
  normalizeCareTable,
} from "@/lib/wiki-care";
import { requireV2Store } from "@/v2/auth";

type CompleteMaterialBody = {
  flowerName?: unknown;
};

/** Keep AI material fields bounded before they reach the drawer form. */
const MAX_AI_COLOR_TAGS = 20;
const MAX_AI_ALIASES = 20;
const MAX_AI_TEXT_LENGTH = 200;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const entries: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || entries.includes(text)) continue;
    entries.push(text);
    if (entries.length >= limit) break;
  }
  return entries;
}

function optionalText(value: unknown, maxLength = MAX_AI_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

/**
 * V2-only material knowledge completion. Authorization, V2 database context and
 * the DeepSeek call stay on the V2 side; no V1 database or V1 permission helper
 * is involved, and the API key is never returned or logged.
 *
 * The response is a superset of the V1 `complete-flower` contract: the V1 wiki
 * fields keep their exact shape, parity fields are additive and may be empty.
 */
export async function POST(request: Request) {
  try {
    await requireV2Store("catalog");
  } catch (cause) {
    return errorResponse(
      cause instanceof Error ? cause.message : "没有物料维护权限",
      403,
    );
  }

  let body: CompleteMaterialBody;
  try {
    body = (await request.json()) as CompleteMaterialBody;
  } catch {
    return errorResponse("请求内容必须为 JSON", 400);
  }

  const flowerName =
    typeof body?.flowerName === "string" ? body.flowerName.trim() : "";
  if (!flowerName) {
    return errorResponse("请填写花材中文名", 400);
  }

  try {
    const result = await completeFlowerWithDeepSeek(flowerName);
    const careTable = normalizeAiCareTable(normalizeCareTable(result.careTable));
    return NextResponse.json({
      success: true,
      data: {
        combinedEnglishName: formatWikiEnglishName(
          result.latinName,
          result.englishName,
        ),
        latinName: result.latinName,
        englishName: result.englishName,
        flowerLanguage: result.flowerLanguage,
        careTable,
        colorTags: stringList(result.colorTags, MAX_AI_COLOR_TAGS),
        morphology: optionalText(result.morphology),
        supplySeason: optionalText(result.supplySeason, 120),
        floralRole: optionalText(result.floralRole, 32),
        suggestedAliases: stringList(result.suggestedAliases, MAX_AI_ALIASES),
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "AI 补全失败";
    const status = message.includes("DEEPSEEK_API_KEY") ? 503 : 502;
    return errorResponse(message, status);
  }
}
