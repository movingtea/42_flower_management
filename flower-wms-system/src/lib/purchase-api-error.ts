import { Prisma } from "@/generated/prisma/client";

export function mapPurchaseApiError(
  err: unknown,
  fallback = "采购操作失败"
): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return { message: "数据已存在，请检查后重试", status: 409 };
    if (err.code === "P2025") return { message: "记录不存在", status: 404 };
    if (err.code === "P2003") {
      return {
        message: "采购明细关联无效，请重新选择花材或通用物料后保存",
        status: 400,
      };
    }
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("不存在")) return { message: msg, status: 404 };
    if (
      msg.includes("重复") ||
      msg.includes("已入库") ||
      msg.includes("已取消") ||
      msg.includes("并发") ||
      msg.includes("冲突")
    ) {
      return { message: msg, status: 409 };
    }
    if (
      msg.includes("不能为空") ||
      msg.includes("必须") ||
      msg.includes("不能小于") ||
      msg.includes("请选择") ||
      msg.includes("无效") ||
      msg.includes("不一致") ||
      msg.includes("已停用") ||
      msg.includes("格式") ||
      msg.includes("至少") ||
      msg.includes("日期") ||
      msg.includes("操作员")
    ) {
      return { message: msg, status: 400 };
    }
    if (msg.includes("无权") || msg.includes("未登录")) {
      return { message: msg, status: msg.includes("未登录") ? 401 : 403 };
    }
    return { message: msg, status: 500 };
  }
  return { message: fallback, status: 500 };
}

/** Preview API: reference validation failures should be 400, not 404. */
export function mapPurchasePreviewApiError(
  err: unknown,
  fallback = "采购成本预览失败"
): { message: string; status: number } {
  const mapped = mapPurchaseApiError(err, fallback);
  if (mapped.status === 404 && err instanceof Error) {
    return { message: mapped.message, status: 400 };
  }
  return mapped;
}
