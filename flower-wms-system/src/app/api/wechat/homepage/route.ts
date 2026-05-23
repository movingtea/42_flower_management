import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import {
  GLOBAL_NOTICE_KEY,
  HOME_POPUP_KEY,
  defaultGlobalNotice,
  defaultHomePopup,
  parseGlobalNoticeValue,
  parseHomePopupValue,
} from "@/lib/app-marketing";
import { loadWechatHomeProductCategories } from "@/lib/product-category.server";
import { loadWechatHomeBanners } from "@/lib/banner.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CONFIG_KEYS = [GLOBAL_NOTICE_KEY, HOME_POPUP_KEY] as const;

/** GET：小程序首页超级接口（轮播 + 公告 + 弹窗 + 分类） */
export async function GET() {
  try {
    const [banners, rows, categories] = await Promise.all([
      loadWechatHomeBanners(),
      prisma.appConfig.findMany({
        where: { key: { in: [...CONFIG_KEYS] } },
      }),
      loadWechatHomeProductCategories(),
    ]);

    const valueByKey = new Map(rows.map((r) => [r.key, r.value]));

    const notice = valueByKey.has(GLOBAL_NOTICE_KEY)
      ? parseGlobalNoticeValue(valueByKey.get(GLOBAL_NOTICE_KEY))
      : defaultGlobalNotice();

    const popup = valueByKey.has(HOME_POPUP_KEY)
      ? parseHomePopupValue(valueByKey.get(HOME_POPUP_KEY))
      : defaultHomePopup();

    return jsonWechatSuccess({
      banners,
      categories,
      notice,
      popup,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "首页配置加载失败";
    return jsonError(message, 500);
  }
}
