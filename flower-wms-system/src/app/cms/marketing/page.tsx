import { MarketingSettings } from "@/app/cms/marketing/MarketingSettings";
import {
  GLOBAL_NOTICE_KEY,
  HOME_POPUP_KEY,
  parseGlobalNoticeValue,
  parseHomePopupValue,
} from "@/lib/app-marketing";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CmsMarketingPage() {
  const [noticeRow, popupRow] = await Promise.all([
    prisma.appConfig.findUnique({ where: { key: GLOBAL_NOTICE_KEY } }),
    prisma.appConfig.findUnique({ where: { key: HOME_POPUP_KEY } }),
  ]);

  return (
    <MarketingSettings
      initialNotice={parseGlobalNoticeValue(noticeRow?.value ?? null)}
      initialPopup={parseHomePopupValue(popupRow?.value ?? null)}
      noticeUpdatedAt={noticeRow?.updatedAt.toISOString() ?? null}
      popupUpdatedAt={popupRow?.updatedAt.toISOString() ?? null}
    />
  );
}
