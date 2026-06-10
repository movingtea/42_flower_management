import { RecipientRelationType } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { requirePermission, isResponse } from "@/lib/api-auth";
import { listRecipients } from "@/services/crm";

export const dynamic = "force-dynamic";

function parseRelationType(
  value: string | null
): RecipientRelationType | undefined {
  if (!value) return undefined;
  if (
    Object.values(RecipientRelationType).includes(value as RecipientRelationType)
  ) {
    return value as RecipientRelationType;
  }
  return undefined;
}

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get("customerId") ?? undefined;
    const keyword = searchParams.get("keyword") ?? undefined;
    const relationType = parseRelationType(searchParams.get("relationType"));
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "20");

    const data = await listRecipients({
      customerId,
      keyword,
      relationType,
      page,
      pageSize,
    });

    return jsonSuccess(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "收花人列表查询失败";
    return jsonError(message, 500);
  }
}
