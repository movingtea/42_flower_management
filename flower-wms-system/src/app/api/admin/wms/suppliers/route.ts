import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { mapPurchaseApiError } from "@/lib/purchase-api-error";
import {
  createSupplier,
  listSuppliers,
  parseSupplierListSearchParams,
} from "@/services/purchase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const suppliers = await listSuppliers(parseSupplierListSearchParams(searchParams));
    return jsonSuccess({ items: suppliers });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "供应商查询失败");
    return jsonError(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const supplier = await createSupplier(await request.json());
    return jsonSuccess({ message: "供应商创建成功", supplier }, 201);
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "供应商创建失败");
    return jsonError(message, status);
  }
}
