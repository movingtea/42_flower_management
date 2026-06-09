import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import {
  getOrderCostSnapshotDetail,
  upsertOrderCostSnapshot,
} from "@/services/order-cost";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return { message: "订单不存在", status: 404 };
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("不存在")) return { message: msg, status: 404 };
    return { message: msg, status: 500 };
  }
  return { message: "重算订单成本失败", status: 500 };
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const orderId = id?.trim();
    if (!orderId) return jsonError("订单 ID 无效", 400);

    const snapshot = await upsertOrderCostSnapshot(orderId);
    const detail = await getOrderCostSnapshotDetail(orderId);
    return jsonSuccess({
      message: "订单成本已重新计算",
      snapshot,
      flowerMaterialCostLines: detail.flowerMaterialCostLines,
      packagingCostLines: detail.packagingCostLines,
      warnings: detail.warnings,
    });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
