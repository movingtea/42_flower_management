import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { requireUserFromRequest } from "@/lib/wechat-auth-request";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import {
  createWechatOrder,
  isStockSoldOutError,
  STOCK_SOLD_OUT_MESSAGE,
  type CreateOrderLineInput,
  type CreateWechatOrderPayload,
} from "@/services/order-lifecycle";

export const dynamic = "force-dynamic";

function parseCreateBody(raw: unknown): CreateWechatOrderPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }

  const b = raw as Record<string, unknown>;

  const receiverName =
    typeof b.receiverName === "string" ? b.receiverName.trim() : "";
  const receiverPhone =
    typeof b.receiverPhone === "string" ? b.receiverPhone.trim() : "";
  const deliveryAddress =
    typeof b.deliveryAddress === "string" ? b.deliveryAddress.trim() : "";

  if (!receiverName) throw new Error("请填写收件人姓名");
  if (!receiverPhone) throw new Error("请填写联系电话");
  if (!deliveryAddress) throw new Error("请填写收货地址");

  const deliveryDate =
    typeof b.deliveryDate === "string" ? b.deliveryDate.trim() : "";
  if (!deliveryDate) throw new Error("请选择配送时间");

  const greetingCard =
    typeof b.greetingCard === "string" ? b.greetingCard.trim() : undefined;

  const totalAmount = Number(b.totalAmount);
  const deliveryFee = Number(b.deliveryFee);
  const payAmount = Number(b.payAmount);

  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    throw new Error("商品总额无效");
  }
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) {
    throw new Error("运费无效");
  }
  if (!Number.isFinite(payAmount) || payAmount < 0) {
    throw new Error("实付金额无效");
  }

  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new Error("结算商品不能为空");
  }

  const items: CreateOrderLineInput[] = b.items.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new Error(`items[${index}] 格式无效`);
    }
    const item = row as Record<string, unknown>;
    const skuId = typeof item.skuId === "string" ? item.skuId.trim() : "";
    const quantity = Number(item.quantity);

    if (!skuId) throw new Error(`items[${index}].skuId 不能为空`);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`items[${index}].quantity 须为正整数`);
    }

    return { skuId, quantity };
  });

  return {
    receiverName,
    receiverPhone,
    deliveryAddress,
    deliveryDate,
    greetingCard: greetingCard || undefined,
    totalAmount,
    deliveryFee,
    payAmount,
    items,
  };
}

function mapErrorStatus(err: unknown): { message: string; status: number } {
  if (isStockSoldOutError(err)) {
    return { message: STOCK_SOLD_OUT_MESSAGE, status: 400 };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("库存不足") ||
      msg.includes("抢光") ||
      msg.includes("不存在") ||
      msg.includes("下架") ||
      msg.includes("不一致") ||
      msg.includes("不能为空") ||
      msg.includes("无效") ||
      msg.includes("请填写")
    ) {
      return { message: msg, status: 400 };
    }
    if (msg.includes("未登录")) {
      return { message: msg, status: 401 };
    }
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2034") {
      return { message: "系统繁忙，请稍后重试", status: 400 };
    }
  }

  if (err instanceof Error) {
    return { message: err.message, status: 500 };
  }

  return { message: "创建订单失败", status: 500 };
}

export async function POST(request: Request) {
  try {
    const user = await requireUserFromRequest(request);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体", 400);
    }

    const payload = parseCreateBody(raw);
    const order = await createWechatOrder(user.id, payload);

    return jsonWechatSuccess(
      {
        orderId: order.id,
        orderNo: order.orderNo,
        status: order.status,
        payAmount: order.payAmount,
      },
      201
    );
  } catch (err) {
    const { message, status } = mapErrorStatus(err);
    return jsonError(message, status);
  }
}
