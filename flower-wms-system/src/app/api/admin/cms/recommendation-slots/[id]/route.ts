import { RecommendationSlotType } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import {
  deleteRecommendationSlot,
  getRecommendationSlotDetail,
  updateRecommendationSlot,
} from "@/services/cms-product-operations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function parseOptionalSlotType(raw: unknown): RecommendationSlotType | undefined {
  if (raw === undefined) return undefined;
  if (
    typeof raw === "string" &&
    Object.values(RecommendationSlotType).includes(raw as RecommendationSlotType)
  ) {
    return raw as RecommendationSlotType;
  }
  throw new Error("slotType 无效");
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const slot = await getRecommendationSlotDetail(id);
    return jsonSuccess({ slot });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "加载推荐位详情失败";
    const status = message.includes("不存在") ? 404 : 500;
    return jsonError(message, status);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const slot = await updateRecommendationSlot(id, {
      key: body.key !== undefined ? String(body.key) : undefined,
      name: body.name !== undefined ? String(body.name) : undefined,
      description:
        body.description !== undefined
          ? typeof body.description === "string"
            ? body.description
            : null
          : undefined,
      slotType: parseOptionalSlotType(body.slotType),
      sceneType:
        body.sceneType !== undefined
          ? typeof body.sceneType === "string"
            ? (body.sceneType as never)
            : null
          : undefined,
      isActive:
        body.isActive !== undefined ? Boolean(body.isActive) : undefined,
      sortOrder:
        body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      maxItems:
        body.maxItems !== undefined ? Number(body.maxItems) : undefined,
    });

    return jsonSuccess({ slot });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "更新推荐位失败";
    const status = message.includes("不存在")
      ? 404
      : message.includes("无效")
        ? 400
        : 500;
    return jsonError(message, status);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const slot = await deleteRecommendationSlot(id);
    return jsonSuccess({ slot, message: "推荐位已停用" });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "停用推荐位失败";
    const status = message.includes("不存在") ? 404 : 500;
    return jsonError(message, status);
  }
}
