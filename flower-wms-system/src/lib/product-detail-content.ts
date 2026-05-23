/** 商品详情 HTML 与养护指南 HTML 在 detailContent 中的分隔标记 */
export const PRODUCT_CARE_TIPS_MARKER = "<!--flower-wms-care-tips-->";

export function mergeProductDetailHtml(
  description: string | null,
  maintenanceGuideline: string | null
): string | null {
  const desc = description?.trim() ?? "";
  const care = maintenanceGuideline?.trim() ?? "";
  if (!desc && !care) return null;
  if (!care) return desc;
  if (!desc) return `${PRODUCT_CARE_TIPS_MARKER}${care}`;
  return `${desc}${PRODUCT_CARE_TIPS_MARKER}${care}`;
}

export function splitProductDetailHtml(detailContent: string | null | undefined): {
  description: string;
  maintenanceGuideline: string;
} {
  const raw = detailContent?.trim() ?? "";
  if (!raw) {
    return { description: "", maintenanceGuideline: "" };
  }
  const idx = raw.indexOf(PRODUCT_CARE_TIPS_MARKER);
  if (idx < 0) {
    return { description: raw, maintenanceGuideline: "" };
  }
  return {
    description: raw.slice(0, idx).trim(),
    maintenanceGuideline: raw.slice(idx + PRODUCT_CARE_TIPS_MARKER.length).trim(),
  };
}

/** 从 HTML 提取纯文本摘要（用于 subtitle 字段） */
export function htmlToPlainExcerpt(html: string, maxLen = 500): string {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}
