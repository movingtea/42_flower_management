import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import {
  createWechatOrderWithFifoLock,
  type WechatCreateOrderPayload,
  type WechatOrderItemInput,
} from "@/services/wechat-order";

export const dynamic = "force-dynamic";

function parseOrderBody(raw: unknown): WechatCreateOrderPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }

  const b = raw as Record<string, unknown>;

  const wechatOpenId =
    typeof b.wechatOpenId === "string" ? b.wechatOpenId.trim() : "";
  if (!wechatOpenId) throw new Error("wechatOpenId 不能为空");

  const receiverName =
    typeof b.receiverName === "string" ? b.receiverName.trim() : "";
  const receiverPhone =
    typeof b.receiverPhone === "string" ? b.receiverPhone.trim() : "";
  const deliveryAddress =
    typeof b.deliveryAddress === "string" ? b.deliveryAddress.trim() : "";

  if (!receiverName) throw new Error("receiverName 不能为空");
  if (!receiverPhone) throw new Error("receiverPhone 不能为空");
  if (!deliveryAddress) throw new Error("deliveryAddress 不能为空");

  const totalAmount = Number(b.totalAmount);
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    throw new Error("totalAmount 无效");
  }

  let deliveryTime: string | undefined;
  if (b.deliveryTime != null && b.deliveryTime !== "") {
    const d = new Date(String(b.deliveryTime));
    if (Number.isNaN(d.getTime())) {
      throw new Error("deliveryTime 格式无效");
    }
    deliveryTime = d.toISOString();
  }

  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new Error("items 不能为空");
  }

  const items: WechatOrderItemInput[] = b.items.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new Error(`items[${index}] 格式无效`);
    }
    const item = row as Record<string, unknown>;
    const productId =
      typeof item.productId === "string" ? item.productId.trim() : "";
    const quantity = Number(item.quantity);
    const price = Number(item.price);

    if (!productId) throw new Error(`items[${index}].productId 不能为空`);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`items[${index}].quantity 须为正整数`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`items[${index}].price 无效`);
    }

    return { productId, quantity, price };
  });

  const linesTotal = items.reduce(
    (sum, i) => sum + i.price * i.quantity,
    0
  );
  if (Math.abs(linesTotal - totalAmount) > 0.01) {
    throw new Error(
      `订单总额与明细不一致：明细合计 ${linesTotal.toFixed(2)}，totalAmount ${totalAmount}`
    );
  }

  return {
    wechatOpenId,
    totalAmount,
    receiverName,
    receiverPhone,
    deliveryAddress,
    deliveryTime,
    items,
  };
}

function mapErrorStatus(err: unknown): { message: string; status: number } {
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("库存不足") ||
      msg.includes("不存在") ||
      msg.includes("已下架") ||
      msg.includes("不一致") ||
      msg.includes("不能为空") ||
      msg.includes("无效")
    ) {
      return { message: msg, status: 400 };
    }
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2034") {
      return { message: "并发繁忙，请稍后重试", status: 400 };
    }
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }

  if (err instanceof Error) {
    return { message: err.message, status: 500 };
  }

  return { message: "下单失败", status: 500 };
}

export async function GET() {
  return jsonError("请使用 POST 创建订单", 405);
}

/**
 * POST：小程序下单 — 事务内 FIFO 锁库（remainingQty 扣减）+ 创建待支付订单。
 */
export async function POST(request: Request) {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体 JSON", 400);
    }

    const payload = parseOrderBody(raw);
    const { order, lockSummary } = await createWechatOrderWithFifoLock(payload);

    return jsonWechatSuccess(
      {
        message: "下单成功，库存已锁定",
        order: {
          id: order.id,
          orderNo: order.orderNo,
          status: "PENDING_PAY",
          wechatOpenId: order.wechatOpenId,
          totalAmount: order.totalAmount.toString(),
          receiverName: order.receiverName,
          receiverPhone: order.receiverPhone,
          deliveryAddress: order.deliveryAddress,
          deliveryTime: order.deliveryTime,
          createdAt: order.createdAt,
        },
        lockSummary,
      },
      201
    );
  } catch (err) {
    const { message, status } = mapErrorStatus(err);
    return jsonError(message, status);
  }
}
