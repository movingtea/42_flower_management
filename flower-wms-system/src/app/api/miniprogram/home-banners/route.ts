import { jsonWechatSuccess } from "@/lib/wechat-api";
import { loadWechatHomeBanners } from "@/lib/banner.server";

export const dynamic = "force-dynamic";

/** GET：小程序首页轮播 */
export async function GET() {
  const list = await loadWechatHomeBanners();
  return jsonWechatSuccess({ list, total: list.length });
}
