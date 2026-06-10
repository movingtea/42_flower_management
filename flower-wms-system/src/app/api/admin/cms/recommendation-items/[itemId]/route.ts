import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import {
  removeRecommendationItem,
  updateRecommendationItem,
} from "@/services/cms-product-operations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ itemId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { itemId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;

    const item = await updateRecommendationItem(itemId, {
      productId:
        body.productId !== undefined ? String(body.productId) : undefined,
      skuId:
        body.skuId !== undefined
          ? typeof body.skuId === "string" && body.skuId.trim()
            ? body.skuId.trim()
            : null
          : undefined,
      titleOverride:
        body.titleOverride !== undefined
          ? typeof body.titleOverride === "string"
            ? body.titleOverride
            : null
          : undefined,
      subtitleOverride:
        body.subtitleOverride !== undefined
          ? typeof body.subtitleOverride === "string"
            ? body.subtitleOverride
            : null
          : undefined,
      imageOverride:
        body.imageOverride !== undefined
          ? typeof body.imageOverride === "string"
            ? body.imageOverride
            : null
          : undefined,
      sortOrder:
        body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      isActive:
        body.isActive !== undefined ? Boolean(body.isActive) : undefined,
      startAt:
        body.startAt !== undefined
          ? typeof body.startAt === "string"
            ? body.startAt
            : null
          : undefined,
      endAt:
        body.endAt !== undefined
          ? typeof body.endAt === "string"
            ? body.endAt
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
        action: "RECOMMENDATION_ITEM_UPDATE",
        entityType: "CmsRecommendationItem",
        entityId: item.id,
        summary: `更新推荐位商品项`,
        afterSnapshot: { isActive: item.isActive, productId: item.productId },
      },
      request
    );

    return jsonSuccess({ item });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "更新推荐项失败";
    const status = message.includes("不存在") ? 404 : 500;
    return jsonError(message, status);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { itemId } = await context.params;
    const item = await removeRecommendationItem(itemId);

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.CMS,
        action: "RECOMMENDATION_ITEM_REMOVE",
        entityType: "CmsRecommendationItem",
        entityId: itemId,
        summary: `停用推荐位商品项`,
        afterSnapshot: { isActive: item.isActive },
      },
      request
    );

    return jsonSuccess({ item, message: "推荐项已移除" });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "移除推荐项失败";
    const status = message.includes("不存在") ? 404 : 500;
    return jsonError(message, status);
  }
}
