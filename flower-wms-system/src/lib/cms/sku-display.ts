/** SKU 展示层状态（不改变 isActive / stock 业务语义） */

export type SkuDisplayStatus = "active" | "sold_out" | "inactive";

export function getSkuDisplayStatus(row: {
  isActive?: boolean;
  stock: number;
}): SkuDisplayStatus {
  if (row.isActive === false) return "inactive";
  if (row.stock <= 0) return "sold_out";
  return "active";
}

/** 可售返回 null；否则返回 badge 文案 */
export function getSkuStatusBadgeLabel(
  status: SkuDisplayStatus
): string | null {
  switch (status) {
    case "inactive":
      return "已停用";
    case "sold_out":
      return "卖光啦！";
    default:
      return null;
  }
}

export function skuStatusBadgeClassName(status: SkuDisplayStatus): string {
  switch (status) {
    case "inactive":
      return "bg-zinc-100 text-zinc-600 ring-zinc-200";
    case "sold_out":
      return "bg-amber-100 text-amber-800 ring-amber-200";
    default:
      return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  }
}
