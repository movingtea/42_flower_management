import { jsonError, jsonSuccess } from "@/lib/api";
import { brainfillWikiFields, identifyFlowerLatinName } from "@/lib/wiki-ai";
import { matchFlowerWiki } from "@/services/wiki";
import { serializeWiki } from "@/lib/wiki-serialize";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { base64?: string; mimeType?: string };
    const base64 = body.base64?.replace(/^data:[^;]+;base64,/, "") ?? "";
    if (!base64) return jsonError("请提供 base64 图片", 400);

    const mimeType = body.mimeType ?? "image/jpeg";
    const { englishName, chineseName } = await identifyFlowerLatinName(
      base64,
      mimeType
    );

    const match = await matchFlowerWiki(englishName);
    if (match.hit) {
      return jsonSuccess({
        track: "A",
        wiki: serializeWiki(match.wiki),
      });
    }

    const draft = await brainfillWikiFields(englishName);
    if (chineseName && !draft.suggestedAliases.includes(chineseName)) {
      draft.suggestedAliases.unshift(chineseName);
    }

    return jsonSuccess({
      track: "B",
      englishName,
      draft,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "识别失败", 500);
  }
}
