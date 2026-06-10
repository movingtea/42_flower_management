import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { addRecommendationItem } from "@/services/cms-product-operations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { id: slotId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;

    const productId = String(body.productId ?? "").trim();
    if (!productId) return jsonError("productId 不能为空", 400);

    const result = await addRecommendationItem(slotId, {
      productId,
      skuId:
        typeof body.skuId === "string" && body.skuId.trim()
          ? body.skuId.trim()
          : null,
      titleOverride:
        typeof body.titleOverride === "string" ? body.titleOverride : null,
      subtitleOverride:
        typeof body.subtitleOverride === "string"
          ? body.subtitleOverride
          : null,
      imageOverride:
        typeof body.imageOverride === "string" ? body.imageOverride : null,
      sortOrder:
        body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      isActive:
        body.isActive !== undefined ? Boolean(body.isActive) : undefined,
      startAt:
        typeof body.startAt === "string" ? body.startAt : null,
      endAt: typeof body.endAt === "string" ? body.endAt : null,
      note: typeof body.note === "string" ? body.note : null,
    });

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.CMS,
        action: "RECOMMENDATION_ITEM_ADD",
        entityType: "CmsRecommendationItem",
        entityId: result.item.id,
        summary: `推荐位添加商品 ${productId}`,
        metadata: { slotId, warnings: result.warnings },
      },
      request
    );

    return jsonSuccess(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "添加推荐商品失败";
    const status =
      message.includes("不存在") || message.includes("不属于")
        ? 404
        : message.includes("不能为空")
          ? 400
          : 500;
    return jsonError(message, status);
  }
}
