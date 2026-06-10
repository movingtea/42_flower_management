import { GiftOccasionType } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { requirePermission, isResponse } from "@/lib/api-auth";
import { getOccasionProductRecommendations } from "@/services/crm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const occasionType = searchParams.get("occasionType");
    if (
      !occasionType ||
      !Object.values(GiftOccasionType).includes(occasionType as GiftOccasionType)
    ) {
      return jsonError("occasionType 无效", 400);
    }

    const data = await getOccasionProductRecommendations(
      occasionType as GiftOccasionType,
      5
    );
    return jsonSuccess({ products: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "推荐商品加载失败";
    return jsonError(message, 500);
  }
}
