import { GiftOccasionType } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { listActiveRecommendationsForMiniProgram } from "@/services/cms-product-operations";

export const dynamic = "force-dynamic";

function parseSceneType(raw: string | null): GiftOccasionType | null {
  if (!raw?.trim()) return null;
  if (Object.values(GiftOccasionType).includes(raw as GiftOccasionType)) {
    return raw as GiftOccasionType;
  }
  return null;
}

/** GET：小程序推荐位（?slotKey= &sceneType= &limit=） */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const result = await listActiveRecommendationsForMiniProgram({
      slotKey: params.get("slotKey"),
      sceneType: parseSceneType(params.get("sceneType")),
      limit: params.get("limit"),
    });

    return jsonWechatSuccess(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "推荐位加载失败";
    return jsonError(message, 500);
  }
}
