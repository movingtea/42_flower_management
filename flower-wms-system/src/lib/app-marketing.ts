import { normalizeStoredImagePathRequired } from "@/lib/image-url";

/** AppConfig.key：全局顶部走马灯公告 */
export const GLOBAL_NOTICE_KEY = "GLOBAL_NOTICE";

export const GLOBAL_NOTICE_NAME = "全局通知公告栏";

/** AppConfig.key：首页活动大弹窗 */
export const HOME_POPUP_KEY = "HOME_POPUP";

export const HOME_POPUP_NAME = "首页活动弹窗";

export type GlobalNoticeConfig = {
  enabled: boolean;
  text: string;
};

export type HomePopupConfig = {
  enabled: boolean;
  imageUrl: string;
  linkProductId: string;
};

export function defaultGlobalNotice(): GlobalNoticeConfig {
  return { enabled: false, text: "" };
}

export function defaultHomePopup(): HomePopupConfig {
  return { enabled: false, imageUrl: "", linkProductId: "" };
}

export function parseGlobalNoticeValue(value: unknown): GlobalNoticeConfig {
  if (Array.isArray(value) && value.length > 0) {
    return parseGlobalNoticeValue(value[0]);
  }
  if (!value || typeof value !== "object") {
    return defaultGlobalNotice();
  }
  const o = value as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    text: typeof o.text === "string" ? o.text : "",
  };
}

export function parseHomePopupValue(value: unknown): HomePopupConfig {
  if (Array.isArray(value) && value.length > 0) {
    return parseHomePopupValue(value[0]);
  }
  if (!value || typeof value !== "object") {
    return defaultHomePopup();
  }
  const o = value as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    imageUrl: normalizeStoredImagePathRequired(
      typeof o.imageUrl === "string" ? o.imageUrl : ""
    ),
    linkProductId:
      typeof o.linkProductId === "string" ? o.linkProductId.trim() : "",
  };
}

export function validateGlobalNotice(config: GlobalNoticeConfig): string | null {
  if (config.enabled && !config.text.trim()) {
    return "开启公告时请填写公告文本";
  }
  return null;
}

export function validateHomePopup(config: HomePopupConfig): string | null {
  if (config.enabled && !config.imageUrl) {
    return "开启弹窗时请上传活动图片";
  }
  return null;
}
