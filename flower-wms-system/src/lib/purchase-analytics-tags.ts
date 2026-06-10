type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

export type PurchaseAnalyticsTagKey =
  | "RECOMMEND_MORE"
  | "CAUTIOUS_PURCHASE"
  | "PRIORITIZE_USE"
  | "PRICE_UP"
  | "PRICE_DOWN"
  | "LOW_RISK"
  | "HIGH_LOSS_IMPACT"
  | "SLOW_MOVING"
  | "GOOD_CONVERSION"
  | "INSUFFICIENT_DATA"
  | "STABLE_SUPPLIER"
  | "OBSERVE"
  | (string & {});

export type PurchaseAnalyticsTag = {
  key: string;
  label: string;
};

type TagMeta = {
  label: string;
  description: string;
  variant: BadgeVariant;
};

const TAG_META: Record<string, TagMeta> = {
  RECOMMEND_MORE: {
    label: "建议多买",
    description: "近期采购表现稳定，可继续关注补货机会。",
    variant: "success",
  },
  CAUTIOUS_PURCHASE: {
    label: "谨慎采购",
    description: "损耗影响偏高或价格波动明显，下次采购前建议重点确认。",
    variant: "warning",
  },
  PRIORITIZE_USE: {
    label: "优先消耗",
    description: "批次剩余较多，建议优先安排出库或打样消耗。",
    variant: "info",
  },
  PRICE_UP: {
    label: "价格上涨",
    description: "最近采购价较上次上涨，建议重新比价后再下单。",
    variant: "warning",
  },
  PRICE_DOWN: {
    label: "价格下降",
    description: "最近采购价较上次下降，可关注补货窗口。",
    variant: "success",
  },
  LOW_RISK: {
    label: "低风险",
    description: "当前采购与转化表现较平稳。",
    variant: "success",
  },
  HIGH_LOSS_IMPACT: {
    label: "损耗影响高",
    description: "损耗模型对成本抬升明显，建议观察后续批次状态。",
    variant: "warning",
  },
  SLOW_MOVING: {
    label: "周转慢",
    description: "入库后销售转化偏慢，建议控制采购节奏。",
    variant: "danger",
  },
  GOOD_CONVERSION: {
    label: "转化好",
    description: "销售转化表现较好，可作为稳定补货参考。",
    variant: "success",
  },
  INSUFFICIENT_DATA: {
    label: "数据不足",
    description: "采购次数较少，建议继续观察后再下结论。",
    variant: "default",
  },
  STABLE_SUPPLIER: {
    label: "稳定供应商",
    description: "近期采购频次和损耗影响较稳定，可继续合作观察。",
    variant: "success",
  },
  OBSERVE: {
    label: "观察中",
    description: "采购样本较少，建议继续积累数据后再判断。",
    variant: "default",
  },
};

export function resolvePurchaseTag(tag: PurchaseAnalyticsTag | string): TagMeta & { key: string } {
  const key = typeof tag === "string" ? tag : tag.key;
  const fallbackLabel = typeof tag === "string" ? key : tag.label || key;
  const meta = TAG_META[key];
  if (!meta) {
    return {
      key,
      label: fallbackLabel || "其他",
      description: "系统识别到需要关注的采购信号。",
      variant: "default",
    };
  }
  return { key, ...meta };
}

export function getTagLabel(tag: PurchaseAnalyticsTag | string): string {
  return resolvePurchaseTag(tag).label;
}

export function getTagVariant(tag: PurchaseAnalyticsTag | string): BadgeVariant {
  return resolvePurchaseTag(tag).variant;
}

export function getTagDescription(tag: PurchaseAnalyticsTag | string): string {
  return resolvePurchaseTag(tag).description;
}
