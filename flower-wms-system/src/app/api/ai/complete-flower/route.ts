import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { completeFlowerWithDeepSeek } from "@/lib/deepseek-flower";
import { formatWikiEnglishName } from "@/lib/wiki-care";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("请求体须为 JSON", 400);
    }

    const rawFlowerName =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).flowerName
        : undefined;
    const flowerName =
      typeof rawFlowerName === "string" ? rawFlowerName.trim() : "";

    if (!flowerName) {
      return jsonError("flowerName 不能为空", 400);
    }

    const cached = await prisma.flowerWiki.findFirst({
      where: { chineseName: { equals: flowerName, mode: "insensitive" } },
      select: {
        englishName: true,
        maintenanceCare: true,
        maintenance: true,
      },
    });

    const ai = await completeFlowerWithDeepSeek(flowerName);

    return jsonSuccess({
      flowerName,
      latinName: ai.latinName,
      englishName: ai.englishName,
      combinedEnglishName: formatWikiEnglishName(
        ai.latinName,
        ai.englishName
      ),
      careTable: ai.careTable,
      cachedHint: cached
        ? "已存在同名母表记录，AI 结果仅供参考"
        : undefined,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AI 补全失败，请稍后重试";
    const status = message.includes("未配置") ? 503 : 502;
    return jsonError(message, status);
  }
}
