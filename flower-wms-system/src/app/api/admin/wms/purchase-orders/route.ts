import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { mapPurchaseApiError } from "@/lib/purchase-api-error";
import {
  createPurchaseOrder,
  listPurchaseOrders,
  parsePurchaseOrderListSearchParams,
} from "@/services/purchase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const result = await listPurchaseOrders(
      parsePurchaseOrderListSearchParams(searchParams)
    );
    return jsonSuccess(result);
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "采购单查询失败");
    return jsonError(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const purchaseOrder = await createPurchaseOrder(await request.json());
    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.PURCHASE,
        action: "PURCHASE_ORDER_CREATE",
        entityType: "PurchaseOrder",
        entityId: purchaseOrder.id,
        summary: `创建采购单 ${purchaseOrder.purchaseNo}`,
        afterSnapshot: {
          purchaseNo: purchaseOrder.purchaseNo,
          status: purchaseOrder.status,
        },
      },
      request
    );
    return jsonSuccess(
      {
        message: `采购单创建成功，系统单号：${purchaseOrder.purchaseNo}`,
        purchaseOrder,
      },
      201
    );
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "采购单创建失败");
    return jsonError(message, status);
  }
}
