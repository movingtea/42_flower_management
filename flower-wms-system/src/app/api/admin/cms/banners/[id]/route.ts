import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { jsonAdminBusinessError, ADMIN_ERROR_CODES } from "@/lib/business-errors";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { parseBannerTargetType } from "@/lib/banner";
import {
  cmsBannerToApiPayload,
  getCmsBannerById,
  softDeleteCmsBanner,
  updateCmsBanner,
} from "@/services/cms-banners";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const banner = await getCmsBannerById(id);
    if (!banner) return jsonError("轮播图不存在", 404);

    return jsonSuccess({ banner: cmsBannerToApiPayload(banner) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "加载轮播详情失败";
    return jsonError(message, 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const before = await getCmsBannerById(id);
    if (!before) return jsonError("轮播图不存在", 404);

    const body = (await request.json()) as Record<string, unknown>;

    const banner = await updateCmsBanner(id, {
      imageUrl:
        body.imageUrl !== undefined ? String(body.imageUrl) : undefined,
      sortOrder:
        body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      targetType:
        body.targetType !== undefined
          ? parseBannerTargetType(body.targetType)
          : undefined,
      targetParam:
        body.targetParam !== undefined
          ? typeof body.targetParam === "string"
            ? body.targetParam
            : null
          : undefined,
      productId:
        body.productId !== undefined
          ? typeof body.productId === "string"
            ? body.productId
            : null
          : undefined,
      isActive:
        body.isActive !== undefined ? Boolean(body.isActive) : undefined,
      startsAt:
        body.startsAt !== undefined
          ? body.startsAt
            ? String(body.startsAt)
            : null
          : undefined,
      endsAt:
        body.endsAt !== undefined
          ? body.endsAt
            ? String(body.endsAt)
            : null
          : undefined,
    });

    const action =
      before.isActive !== banner.isActive
        ? banner.isActive
          ? "BANNER_ENABLE"
          : "BANNER_DEACTIVATE"
        : "BANNER_UPDATE";

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.CMS,
        action,
        entityType: "Banner",
        entityId: banner.id,
        summary:
          action === "BANNER_ENABLE"
            ? `启用首页轮播图`
            : action === "BANNER_DEACTIVATE"
              ? `停用首页轮播图`
              : `编辑首页轮播图`,
        beforeSnapshot: {
          sortOrder: before.sortOrder,
          isActive: before.isActive,
        },
        afterSnapshot: {
          sortOrder: banner.sortOrder,
          isActive: banner.isActive,
        },
      },
      request
    );

    return jsonSuccess({ banner: cmsBannerToApiPayload(banner) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新轮播失败";
    return jsonError(message, 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const before = await getCmsBannerById(id);
    if (!before) {
      return jsonAdminBusinessError(
        ADMIN_ERROR_CODES.ENTITY_NOT_FOUND,
        "轮播图不存在",
        404
      );
    }

    const banner = await softDeleteCmsBanner(id);
    const alreadyDeleted = before.isDeleted;

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.CMS,
        action: "BANNER_DELETE",
        entityType: "Banner",
        entityId: banner.id,
        summary: alreadyDeleted
          ? `重复删除首页轮播图（已软删除）`
          : `删除首页轮播图`,
        beforeSnapshot: {
          isActive: before.isActive,
          isDeleted: before.isDeleted,
        },
        afterSnapshot: {
          isActive: banner.isActive,
          isDeleted: banner.isDeleted,
        },
      },
      request
    );

    return jsonSuccess({
      banner: cmsBannerToApiPayload(banner),
      alreadyDeleted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除轮播失败";
    return jsonError(message, 500);
  }
}
