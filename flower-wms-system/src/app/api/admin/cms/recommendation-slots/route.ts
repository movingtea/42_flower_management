import { RecommendationSlotType } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import {
  createRecommendationSlot,
  listRecommendationSlots,
  listRecommendationSlotsLite,
} from "@/services/cms-product-operations";

export const dynamic = "force-dynamic";

function parseSlotType(raw: unknown): RecommendationSlotType {
  if (
    typeof raw === "string" &&
    Object.values(RecommendationSlotType).includes(raw as RecommendationSlotType)
  ) {
    return raw as RecommendationSlotType;
  }
  throw new Error("slotType 无效");
}

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const params = new URL(request.url).searchParams;
    if (params.get("lite") === "true") {
      const slots = await listRecommendationSlotsLite();
      return jsonSuccess({ slots });
    }

    const isActiveRaw = params.get("isActive");
    const slotTypeRaw = params.get("slotType");

    const slots = await listRecommendationSlots({
      isActive:
        isActiveRaw === "true"
          ? true
          : isActiveRaw === "false"
            ? false
            : null,
      slotType: slotTypeRaw
        ? parseSlotType(slotTypeRaw)
        : null,
    });

    return jsonSuccess({ slots });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "加载推荐位列表失败";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const body = (await request.json()) as Record<string, unknown>;
    const slot = await createRecommendationSlot({
      key: String(body.key ?? ""),
      name: String(body.name ?? ""),
      description:
        typeof body.description === "string" ? body.description : null,
      slotType: parseSlotType(body.slotType),
      sceneType:
        typeof body.sceneType === "string"
          ? (body.sceneType as never)
          : null,
      isActive: body.isActive !== false,
      sortOrder: Number(body.sortOrder ?? 0),
      maxItems: Number(body.maxItems ?? 10),
    });

    return jsonSuccess({ slot });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "创建推荐位失败";
    const status =
      message.includes("不能为空") ||
      message.includes("无效") ||
      message.includes("已被使用")
        ? 400
        : 500;
    return jsonError(message, status);
  }
}
