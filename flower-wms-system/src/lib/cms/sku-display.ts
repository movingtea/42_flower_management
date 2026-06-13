/** SKU 展示层状态（不改变 isActive / stock 业务语义） */

export type SkuDisplayStatus = "active" | "sold_out" | "inactive";

export type SkuLabelContext = "cms" | "miniprogram";

export type CmsSkuEditorBadge = {
  label: string;
  hint?: string;
  status: SkuDisplayStatus | "draft";
};

export function getSkuDisplayStatus(row: {
  isActive?: boolean;
  stock: number;
}): SkuDisplayStatus {
  if (row.isActive === false) return "inactive";
  if (row.stock <= 0) return "sold_out";
  return "active";
}

const CMS_STATUS_LABELS: Record<SkuDisplayStatus, string | null> = {
  active: null,
  sold_out: "库存为 0",
  inactive: "已停用",
};

const MINIPROGRAM_STATUS_LABELS: Record<SkuDisplayStatus, string | null> = {
  active: null,
  sold_out: "卖光啦！",
  inactive: "该规格暂不可售",
};

/** 按使用场景返回 badge 文案；active 返回 null，由调用方显示「可售」 */
export function getSkuStatusBadgeLabel(
  status: SkuDisplayStatus,
  context: SkuLabelContext = "cms"
): string | null {
  const labels =
    context === "miniprogram" ? MINIPROGRAM_STATUS_LABELS : CMS_STATUS_LABELS;
  return labels[status];
}

/** CMS 商品编辑页 SKU 卡片：区分未保存 / 运营文案，不使用「卖光啦！」 */
export function getCmsSkuEditorBadge(row: {
  id?: string;
  isActive?: boolean;
  stock: number | null | undefined;
}): CmsSkuEditorBadge {
  if (!row.id) {
    return { label: "未保存", status: "draft" };
  }

  const stock = row.stock ?? 0;
  const status = getSkuDisplayStatus({
    isActive: row.isActive,
    stock,
  });

  if (status === "inactive") {
    const hint =
      stock > 0
        ? "该规格已停用，即使有库存也不会在小程序售卖"
        : undefined;
    return { label: "已停用", hint, status };
  }

  if (status === "sold_out") {
    return {
      label: "库存为 0",
      hint: "小程序前台将显示售罄",
      status,
    };
  }

  return { label: "可售", status };
}

export function skuStatusBadgeClassName(
  status: SkuDisplayStatus | "draft"
): string {
  switch (status) {
    case "draft":
      return "bg-sky-100 text-sky-800 ring-sky-200";
    case "inactive":
      return "bg-zinc-100 text-zinc-600 ring-zinc-200";
    case "sold_out":
      return "bg-amber-100 text-amber-800 ring-amber-200";
    default:
      return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  }
}
