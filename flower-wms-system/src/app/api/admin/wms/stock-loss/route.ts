import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { resolveOperatorContext } from "@/lib/operator-context";
import {
  attachOperatorToStockLossPayload,
  parseStockLossBody,
  runStockLossTransaction,
} from "@/services/wms-stock";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const body = await request.json();
    const base = parseStockLossBody(body);
    const operator = await resolveOperatorContext(staff.id);
    const payload = attachOperatorToStockLossPayload(base, operator);
    const result = await runStockLossTransaction(payload);

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.INVENTORY,
        action: "STOCK_LOSS",
        entityType: "Batch",
        entityId: result.batchId,
        summary: `批次报损 ${result.lossQuantity}（批次 ${result.batchNo ?? result.batchId}）`,
        afterSnapshot: { remainingQty: result.remainingQty },
      },
      request
    );

    return jsonSuccess({
      message: "指定批次报损核销成功",
      materialId: result.materialId,
      materialName: result.materialName,
      batchId: result.batchId,
      batchNo: result.batchNo,
      lossQuantity: result.lossQuantity,
      remainingQty: result.remainingQty,
      lossRecordId: result.lossRecordId,
      operatorStaffId: operator.operatorStaffId,
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
