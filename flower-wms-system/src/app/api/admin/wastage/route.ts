import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import {
  registerBatchWastage,
  type RegisterWastagePayload,
} from "@/services/wastage";

export const dynamic = "force-dynamic";

function parseWastageBody(raw: unknown): RegisterWastagePayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }

  const b = raw as Record<string, unknown>;

  const batchId = typeof b.batchId === "string" ? b.batchId.trim() : "";
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  const operatorId =
    typeof b.operatorId === "string" ? b.operatorId.trim() : "";

  if (!batchId) throw new Error("batchId 不能为空");
  if (!reason) throw new Error("reason 不能为空");
  if (!operatorId) throw new Error("operatorId 不能为空");

  const wastageQty = Number(b.wastageQty);
  if (!Number.isInteger(wastageQty) || wastageQty <= 0) {
    throw new Error("wastageQty 须为正整数");
  }

  return { batchId, wastageQty, reason, operatorId };
}

function mapErrorStatus(err: unknown): { message: string; status: number } {
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg === "报损数量不能大于当前批次剩余库存" ||
      msg === "批次不存在" ||
      msg.includes("不能为空") ||
      msg.includes("须为")
    ) {
      return { message: msg, status: 400 };
    }
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }

  if (err instanceof Error) {
    return { message: err.message, status: 500 };
  }

  return { message: "损耗登记失败", status: 500 };
}

export async function POST(request: Request) {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体 JSON", 400);
    }

    const payload = parseWastageBody(raw);
    const result = await registerBatchWastage(payload);

    return jsonSuccess({
      message: "损耗核销成功",
      batch: result.batch,
      stockLog: result.stockLog,
    });
  } catch (err) {
    const { message, status } = mapErrorStatus(err);
    return jsonError(message, status);
  }
}
