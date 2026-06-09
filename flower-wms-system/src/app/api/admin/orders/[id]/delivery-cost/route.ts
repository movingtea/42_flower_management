import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { upsertOrderCostSnapshot } from "@/services/order-cost";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function parseBody(raw: unknown): {
  deliveryCostActual: string;
  deliveryCostNote: string | null;
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const b = raw as Record<string, unknown>;
  const cost = Number(b.deliveryCostActual);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("实际配送成本须为非负数字");
  }

  return {
    deliveryCostActual: cost.toFixed(2),
    deliveryCostNote:
      typeof b.deliveryCostNote === "string" && b.deliveryCostNote.trim()
        ? b.deliveryCostNote.trim()
        : null,
  };
}

function mapError(err: unknown): { message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return { message: "订单不存在", status: 404 };
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("须为") || msg.includes("不能为空") || msg.includes("无效")) {
      return { message: msg, status: 400 };
    }
    if (msg.includes("不存在")) return { message: msg, status: 404 };
    return { message: msg, status: 500 };
  }
  return { message: "更新配送成本失败", status: 500 };
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const orderId = id?.trim();
    if (!orderId) return jsonError("订单 ID 无效", 400);

    const body = parseBody(await request.json());
    const snapshot = await prisma.$transaction(
      async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: {
            deliveryCostActual: body.deliveryCostActual,
            deliveryCostNote: body.deliveryCostNote,
          },
        });
        return upsertOrderCostSnapshot(orderId, tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 30000,
      }
    );

    return jsonSuccess({ message: "配送成本已更新", snapshot });
  } catch (err) {
    const { message, status } = mapError(err);
    return jsonError(message, status);
  }
}
