import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import {
  runPurchaseInboundTransaction,
  type PurchaseInboundPayload,
} from "@/services/inbound";

export const dynamic = "force-dynamic";

function parseMaterialCategoryIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter(Boolean)
      ),
    ];
  }
  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim()];
  }
  return [];
}

function parseInboundBody(raw: unknown): PurchaseInboundPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }

  const b = raw as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new Error("name 不能为空");

  const materialCategoryIds = parseMaterialCategoryIds(
    b.materialCategoryIds ?? b.categoryId ?? b.category
  );
  if (materialCategoryIds.length === 0) {
    throw new Error("请至少选择一个原材料分类");
  }

  const receivedQty = Number(b.receivedQty);
  if (!Number.isInteger(receivedQty) || receivedQty <= 0) {
    throw new Error("receivedQty 须为正整数");
  }

  const costPrice = Number(b.costPrice);
  if (!Number.isFinite(costPrice) || costPrice < 0) {
    throw new Error("costPrice 须为不小于 0 的数字");
  }

  const safetyStockThreshold = Number(b.safetyStockThreshold);
  if (!Number.isInteger(safetyStockThreshold) || safetyStockThreshold < 0) {
    throw new Error("safetyStockThreshold 须为非负整数");
  }

  let expiryDate: string | undefined;
  if (b.expiryDate != null && b.expiryDate !== "") {
    const d = new Date(String(b.expiryDate));
    if (Number.isNaN(d.getTime())) {
      throw new Error("expiryDate 日期格式无效");
    }
    expiryDate = d.toISOString();
  }

  const supplierName =
    typeof b.supplierName === "string" ? b.supplierName.trim() : undefined;

  return {
    name,
    materialCategoryIds,
    safetyStockThreshold,
    receivedQty,
    costPrice,
    expiryDate,
    supplierName: supplierName || undefined,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = Array.isArray(err.meta?.target)
        ? (err.meta.target as string[]).join(", ")
        : "唯一字段";
      return `数据冲突：${target} 已存在`;
    }
    return `数据库错误 (${err.code})`;
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return "数据不符合数据库约束";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "采购入库失败";
}

export async function POST(request: Request) {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体 JSON", 500);
    }

    const body = parseInboundBody(raw);
    const result = await runPurchaseInboundTransaction(body);

    return jsonSuccess(
      {
        message: "采购入库成功",
        materialCreated: result.materialCreated,
        material: {
          id: result.material.id,
          materialCode: result.material.materialCode,
          name: result.material.name,
          unit: result.material.unit,
          safetyStockThreshold: result.material.safetyStockThreshold,
        },
        batch: {
          id: result.batch.id,
          batchNo: result.batch.batchNo,
          materialId: result.batch.materialId,
          receivedQty: result.batch.originalQty,
          availableQty: result.batch.remainingQty,
          costPrice: result.batch.unitCost.toString(),
          expiryDate: result.batch.expiresAt,
          supplierName: result.batch.supplier,
          inboundAt: result.batch.inboundAt,
        },
        stockLog: {
          id: result.stockLog.id,
          type: "IN",
          quantity: result.stockLog.quantity,
          reason: result.stockLog.remark,
        },
      },
      201
    );
  } catch (err) {
    return jsonError(errorMessage(err), 500);
  }
}
