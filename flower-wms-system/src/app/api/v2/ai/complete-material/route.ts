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

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * V2-only material knowledge completion. Authorization, V2 database context and
 * the DeepSeek call stay on the V2 side; no V1 database or V1 permission helper
 * is involved, and the API key is never returned or logged.
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
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "AI 补全失败";
    const status = message.includes("DEEPSEEK_API_KEY") ? 503 : 502;
    return errorResponse(message, status);
  }
}
