import {
  GiftOccasionType,
  HomeSceneEntryTargetType,
} from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import {
  createHomeSceneEntry,
  listHomeSceneEntries,
  seedMissingDefaultHomeSceneEntries,
} from "@/services/cms-home-scene-entries";

export const dynamic = "force-dynamic";

function parseSceneType(raw: unknown): GiftOccasionType {
  if (
    typeof raw === "string" &&
    Object.values(GiftOccasionType).includes(raw as GiftOccasionType)
  ) {
    return raw as GiftOccasionType;
  }
  throw new Error("sceneType 无效");
}

function parseTargetType(raw: unknown): HomeSceneEntryTargetType | undefined {
  if (raw == null || raw === "") return undefined;
  if (
    typeof raw === "string" &&
    Object.values(HomeSceneEntryTargetType).includes(
      raw as HomeSceneEntryTargetType
    )
  ) {
    return raw as HomeSceneEntryTargetType;
  }
  throw new Error("targetType 无效");
}

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const params = new URL(request.url).searchParams;
    const sceneTypeRaw = params.get("sceneType");

    const result = await listHomeSceneEntries({
      includeInactive: params.get("includeInactive") !== "false",
      keyword: params.get("keyword"),
      sceneType: sceneTypeRaw ? parseSceneType(sceneTypeRaw) : null,
    });

    return jsonSuccess(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "加载首页场景入口失败";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const body = (await request.json()) as Record<string, unknown>;

    if (body.action === "seed-defaults") {
      const result = await seedMissingDefaultHomeSceneEntries();
      return jsonSuccess(result);
    }

    const entry = await createHomeSceneEntry({
      title: String(body.title ?? ""),
      subtitle:
        typeof body.subtitle === "string" ? body.subtitle : null,
      sceneType: parseSceneType(body.sceneType),
      iconKey: String(body.iconKey ?? ""),
      sortOrder: Number(body.sortOrder ?? 0),
      isActive: body.isActive !== false,
      targetType: parseTargetType(body.targetType),
      targetValue:
        typeof body.targetValue === "string" ? body.targetValue : null,
      linkedRecommendationSlotId:
        typeof body.linkedRecommendationSlotId === "string"
          ? body.linkedRecommendationSlotId
          : null,
      linkedRecommendationSlotKey:
        typeof body.linkedRecommendationSlotKey === "string"
          ? body.linkedRecommendationSlotKey
          : null,
      note: typeof body.note === "string" ? body.note : null,
    });

    return jsonSuccess({ entry });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "创建首页场景入口失败";
    return jsonError(message, 500);
  }
}
