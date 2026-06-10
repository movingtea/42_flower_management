import { CustomerSource } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { requirePermission, isResponse } from "@/lib/api-auth";
import { listCustomers } from "@/services/crm";

export const dynamic = "force-dynamic";

function parseSource(value: string | null): CustomerSource | undefined {
  if (!value) return undefined;
  if (Object.values(CustomerSource).includes(value as CustomerSource)) {
    return value as CustomerSource;
  }
  return undefined;
}

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get("keyword") ?? undefined;
    const source = parseSource(searchParams.get("source"));
    const minOrdersRaw = searchParams.get("minOrders");
    const minOrders = minOrdersRaw ? Number(minOrdersRaw) : undefined;
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "20");

    const data = await listCustomers({
      keyword,
      source,
      minOrders: Number.isFinite(minOrders) ? minOrders : undefined,
      page,
      pageSize,
    });

    return jsonSuccess(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "客户列表查询失败";
    return jsonError(message, 500);
  }
}
