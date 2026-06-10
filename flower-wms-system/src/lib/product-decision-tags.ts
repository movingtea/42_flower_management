type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

export type ProductDecisionTagKey =
  | "RECOMMEND_PROMOTE"
  | "OBSERVE"
  | "LOW_MARGIN"
  | "HIGH_LOSS_SENSITIVITY"
  | "PRICE_INCREASE_SUGGESTED"
  | "RECIPE_OPTIMIZATION_SUGGESTED"
  | "IMAGE_PRODUCT"
  | "DATA_INSUFFICIENT"
  | "HEALTHY_MARGIN"
  | "GOOD_SALES"
  | "LOW_SALES"
  | "COST_STRUCTURE_RISK"
  | "PACKAGING_COST_RISK"
  | "MISSING_RECIPE"
  | "MISSING_COST_DATA"
  | (string & {});

export type ProductHealthStatusKey =
  | "RECOMMENDED"
  | "HEALTHY"
  | "OBSERVE"
  | "RISKY"
  | "LOW_MARGIN"
  | "IMAGE_ONLY"
  | "INCOMPLETE_DATA"
  | (string & {});

export type LossSensitivityLevelKey = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | (string & {});

export type ProductDecisionTagLike = {
  key: string;
  label?: string;
  reason?: string;
  severity?: string;
};

type TagMeta = {
  label: string;
  variant: BadgeVariant;
};

type HealthMeta = {
  label: string;
  variant: BadgeVariant;
};

const TAG_META: Record<string, TagMeta> = {
  RECOMMEND_PROMOTE: { label: "推荐主推", variant: "success" },
  OBSERVE: { label: "继续观察", variant: "default" },
  LOW_MARGIN: { label: "低毛利", variant: "danger" },
  HIGH_LOSS_SENSITIVITY: { label: "损耗敏感", variant: "warning" },
  PRICE_INCREASE_SUGGESTED: { label: "建议调价", variant: "warning" },
  RECIPE_OPTIMIZATION_SUGGESTED: { label: "建议优化配方", variant: "warning" },
  IMAGE_PRODUCT: { label: "形象款", variant: "info" },
  DATA_INSUFFICIENT: { label: "数据不足", variant: "default" },
  HEALTHY_MARGIN: { label: "毛利健康", variant: "success" },
  GOOD_SALES: { label: "销量较好", variant: "success" },
  LOW_SALES: { label: "销量偏低", variant: "default" },
  COST_STRUCTURE_RISK: { label: "成本结构风险", variant: "warning" },
  PACKAGING_COST_RISK: { label: "包装成本偏高", variant: "warning" },
  MISSING_RECIPE: { label: "未绑定配方", variant: "danger" },
  MISSING_COST_DATA: { label: "成本数据不完整", variant: "warning" },
};

const HEALTH_META: Record<string, HealthMeta> = {
  RECOMMENDED: { label: "推荐主推", variant: "success" },
  HEALTHY: { label: "健康", variant: "success" },
  OBSERVE: { label: "继续观察", variant: "default" },
  RISKY: { label: "高风险", variant: "danger" },
  LOW_MARGIN: { label: "低毛利", variant: "danger" },
  IMAGE_ONLY: { label: "形象款", variant: "info" },
  INCOMPLETE_DATA: { label: "数据不完整", variant: "warning" },
};

const SENSITIVITY_META: Record<string, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
  UNKNOWN: "未知",
};

const SEVERITY_VARIANT: Record<string, BadgeVariant> = {
  success: "success",
  info: "info",
  warning: "warning",
  danger: "danger",
  neutral: "default",
};

export function resolveProductDecisionTag(tag: ProductDecisionTagLike | string) {
  const key = typeof tag === "string" ? tag : tag.key;
  const apiLabel = typeof tag === "string" ? undefined : tag.label;
  const meta = TAG_META[key];
  return {
    key,
    label: apiLabel || meta?.label || key || "其他",
    variant: meta?.variant ?? "default",
    reason: typeof tag === "string" ? undefined : tag.reason,
    severity: typeof tag === "string" ? undefined : tag.severity,
  };
}

export function getProductDecisionTagLabel(tag: ProductDecisionTagLike | string): string {
  return resolveProductDecisionTag(tag).label;
}

export function getProductDecisionTagVariant(tag: ProductDecisionTagLike | string): BadgeVariant {
  const resolved = resolveProductDecisionTag(tag);
  if (resolved.severity && SEVERITY_VARIANT[resolved.severity]) {
    return SEVERITY_VARIANT[resolved.severity];
  }
  return resolved.variant;
}

export function resolveProductHealthStatus(
  status: ProductHealthStatusKey,
  statusLabel?: string | null
) {
  const meta = HEALTH_META[status];
  return {
    key: status,
    label: statusLabel || meta?.label || status || "其他",
    variant: meta?.variant ?? "default",
  };
}

export function getLossSensitivityLabel(level: LossSensitivityLevelKey | null | undefined): string {
  if (!level) return "—";
  return SENSITIVITY_META[level] ?? level;
}

export function getSuggestedPriceAtTarget(
  suggestedPrices: Array<{
    targetMargin: number;
    basedOnMode: string;
    roundedSuggestedPrice: string;
  }>,
  targetMargin = 0.6,
  mode: "STANDARD" | "CONSERVATIVE" = "STANDARD"
): string | null {
  const match = suggestedPrices.find(
    (item) =>
      item.basedOnMode === mode && Math.abs(item.targetMargin - targetMargin) < 0.001
  );
  return match?.roundedSuggestedPrice ?? null;
}

export const KEY_DECISION_TAGS: ProductDecisionTagKey[] = [
  "RECOMMEND_PROMOTE",
  "PRICE_INCREASE_SUGGESTED",
  "LOW_MARGIN",
  "DATA_INSUFFICIENT",
  "HIGH_LOSS_SENSITIVITY",
];

export function pickKeyDecisionTags<T extends { key: string }>(tags: T[], limit = 3): T[] {
  const picked: T[] = [];
  for (const key of KEY_DECISION_TAGS) {
    const found = tags.find((tag) => tag.key === key);
    if (found) picked.push(found);
    if (picked.length >= limit) break;
  }
  if (picked.length < limit) {
    for (const tag of tags) {
      if (!picked.includes(tag)) picked.push(tag);
      if (picked.length >= limit) break;
    }
  }
  return picked;
}
