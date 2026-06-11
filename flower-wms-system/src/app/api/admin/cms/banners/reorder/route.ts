import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import {
  cmsBannerToApiPayload,
  reorderCmsBanners,
} from "@/services/cms-banners";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    const body = (await request.json()) as {
      items?: Array<{ id: string; sortOrder: number }>;
    };

    const items = body.items ?? [];
    const banners = await reorderCmsBanners(items);

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.CMS,
        action: "BANNER_REORDER",
        entityType: "Banner",
        summary: `调整首页轮播图排序`,
        afterSnapshot: { count: items.length },
      },
      request
    );

    return jsonSuccess({
      banners: banners.map(cmsBannerToApiPayload),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "排序失败";
    return jsonError(message, 500);
  }
}
