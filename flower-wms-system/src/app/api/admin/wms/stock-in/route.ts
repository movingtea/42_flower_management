import { jsonError, jsonSuccess } from "@/lib/api";
import {
  parseStockInPayload,
  runStockInTransaction,
} from "@/services/wms-stock";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = parseStockInPayload(body);
    const result = await runStockInTransaction(payload);

    return jsonSuccess(
      {
        message: "入库成功，已创建独立 FIFO 批次",
        batch: {
          id: result.batch.id,
          batchNo: result.batch.batchNo,
          materialId: result.material.id,
          quantity: result.batch.originalQty,
          remainingQty: result.batch.remainingQty,
          unitCost: result.batch.unitCost.toString(),
          supplier: result.batch.supplier,
          inboundAt: result.batch.inboundAt.toISOString(),
          createdAt: result.batch.createdAt.toISOString(),
        },
      },
      201
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "入库失败", 400);
  }
}
