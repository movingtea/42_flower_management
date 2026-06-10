import { AuditModule, GiftOccasionType, HomeSceneEntryTargetType } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import {
  deleteHomeSceneEntry,
  getHomeSceneEntryById,
  updateHomeSceneEntry,
} from "@/services/cms-home-scene-entries";

export const dynamic = "force-dynamic";

function parseSceneType(raw: unknown): GiftOccasionType | undefined {
  if (raw == null || raw === "") return undefined;
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

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const entry = await getHomeSceneEntryById(id);
    if (!entry) return jsonError("场景入口不存在", 404);

    return jsonSuccess({ entry });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "加载场景入口详情失败";
    return jsonError(message, 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;

    const entry = await updateHomeSceneEntry(id, {
      title: body.title !== undefined ? String(body.title) : undefined,
      subtitle:
        body.subtitle !== undefined
          ? typeof body.subtitle === "string"
            ? body.subtitle
            : null
          : undefined,
      sceneType: parseSceneType(body.sceneType),
      iconKey:
        body.iconKey !== undefined ? String(body.iconKey) : undefined,
      sortOrder:
        body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      isActive:
        body.isActive !== undefined ? Boolean(body.isActive) : undefined,
      targetType: parseTargetType(body.targetType),
      targetValue:
        body.targetValue !== undefined
          ? typeof body.targetValue === "string"
            ? body.targetValue
            : null
          : undefined,
      linkedRecommendationSlotId:
        body.linkedRecommendationSlotId !== undefined
          ? typeof body.linkedRecommendationSlotId === "string"
            ? body.linkedRecommendationSlotId
            : null
          : undefined,
      linkedRecommendationSlotKey:
        body.linkedRecommendationSlotKey !== undefined
          ? typeof body.linkedRecommendationSlotKey === "string"
            ? body.linkedRecommendationSlotKey
            : null
          : undefined,
      note:
        body.note !== undefined
          ? typeof body.note === "string"
            ? body.note
            : null
          : undefined,
    });

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.CMS,
        action: "HOME_SCENE_ENTRY_UPDATE",
        entityType: "CmsHomeSceneEntry",
        entityId: entry.id,
        summary: `更新首页场景入口「${entry.title}」`,
        afterSnapshot: { isActive: entry.isActive, sortOrder: entry.sortOrder },
      },
      request
    );

    return jsonSuccess({ entry });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "更新场景入口失败";
    return jsonError(message, 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    await deleteHomeSceneEntry(id);

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.CMS,
        action: "HOME_SCENE_ENTRY_DELETE",
        entityType: "CmsHomeSceneEntry",
        entityId: id,
        summary: `删除首页场景入口`,
      },
      request
    );

    return jsonSuccess({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "删除场景入口失败";
    return jsonError(message, 500);
  }
}
