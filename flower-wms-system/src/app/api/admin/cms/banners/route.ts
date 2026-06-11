import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { parseBannerTargetType } from "@/lib/banner";
import {
  cmsBannerToApiPayload,
  createCmsBanner,
  listCmsBanners,
} from "@/services/cms-banners";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const params = new URL(request.url).searchParams;
    const result = await listCmsBanners({
      includeInactive: params.get("includeInactive") !== "false",
    });

    return jsonSuccess({
      banners: result.banners.map(cmsBannerToApiPayload),
      total: result.total,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "轮播加载失败";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const body = (await request.json()) as Record<string, unknown>;

    const banner = await createCmsBanner({
      imageUrl: String(body.imageUrl ?? ""),
      sortOrder: Number(body.sortOrder ?? 100),
      targetType: parseBannerTargetType(body.targetType),
      targetParam:
        typeof body.targetParam === "string" ? body.targetParam : null,
      productId: typeof body.productId === "string" ? body.productId : null,
      isActive: body.isActive !== false,
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

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.CMS,
        action: "BANNER_CREATE",
        entityType: "Banner",
        entityId: banner.id,
        summary: `创建首页轮播图`,
        afterSnapshot: {
          sortOrder: banner.sortOrder,
          isActive: banner.isActive,
          targetType: banner.targetType,
        },
      },
      request
    );

    return jsonSuccess({ banner: cmsBannerToApiPayload(banner) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建轮播失败";
    return jsonError(message, 500);
  }
}
