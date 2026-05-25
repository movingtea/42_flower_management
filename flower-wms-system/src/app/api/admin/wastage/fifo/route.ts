import { jsonError, jsonSuccess } from "@/lib/api";
import { registerMaterialFifoWastage } from "@/services/wastage";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      materialId?: string;
      wastageQty?: number;
      reason?: string;
      operatorId?: string;
    };

    const materialId = body.materialId?.trim() ?? "";
    const reason = body.reason?.trim() ?? "";
    const operatorId = body.operatorId?.trim() || "staff";
    const wastageQty = Number(body.wastageQty);

    if (!materialId) return jsonError("materialId 不能为空", 400);
    if (!reason) return jsonError("reason 不能为空", 400);
    if (!Number.isInteger(wastageQty) || wastageQty <= 0) {
      return jsonError("wastageQty 须为正整数", 400);
    }

    const result = await registerMaterialFifoWastage({
      materialId,
      wastageQty,
      reason,
      operatorId,
    });

    return jsonSuccess({
      message: "FIFO 损耗已登记",
      material: result.material,
      batchCount: result.deductions.length,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "损耗登记失败", 400);
  }
}
