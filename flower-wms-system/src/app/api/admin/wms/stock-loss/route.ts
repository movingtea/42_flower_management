import { jsonError, jsonSuccess } from "@/lib/api";
import {
  parseStockLossPayload,
  runStockLossTransaction,
} from "@/services/wms-stock";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = parseStockLossPayload(body);
    const result = await runStockLossTransaction(payload);

    return jsonSuccess({
      message: "指定批次报损核销成功",
      materialId: result.materialId,
      materialName: result.materialName,
      batchId: result.batchId,
      batchNo: result.batchNo,
      lossQuantity: result.lossQuantity,
      remainingQty: result.remainingQty,
      lossRecordId: result.lossRecordId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "损耗核销失败";
    const status =
      message.includes("超出该批次") || message.includes("库存不足")
        ? 409
        : 400;
    return jsonError(message, status);
  }
}
