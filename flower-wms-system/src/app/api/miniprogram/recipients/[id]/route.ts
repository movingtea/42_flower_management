import { RecipientRelationType } from "@/generated/prisma/enums";
import { AuditModule } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { safeLogAudit } from "@/lib/audit-helpers";
import { requireUserFromRequest } from "@/lib/wechat-auth-request";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import {
  deleteMiniProgramRecipient,
  updateMiniProgramRecipient,
} from "@/services/crm";

export const dynamic = "force-dynamic";

function parseRelationType(
  value: string | null | undefined
): RecipientRelationType | null | undefined {
  if (value === undefined) return undefined;
  if (!value) return null;
  if (
    Object.values(RecipientRelationType).includes(value as RecipientRelationType)
  ) {
    return value as RecipientRelationType;
  }
  return null;
}

function parsePatchBody(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const b = raw as Record<string, unknown>;

  return {
    name: typeof b.name === "string" ? b.name.trim() : undefined,
    phone: typeof b.phone === "string" ? b.phone : undefined,
    address: typeof b.address === "string" ? b.address : undefined,
    relationType: parseRelationType(
      typeof b.relationType === "string" ? b.relationType : undefined
    ),
    relationLabel:
      typeof b.relationLabel === "string" ? b.relationLabel : undefined,
    preferredColors:
      typeof b.preferredColors === "string" ? b.preferredColors : undefined,
    dislikedFlowers:
      typeof b.dislikedFlowers === "string" ? b.dislikedFlowers : undefined,
    preferenceNote:
      typeof b.preferenceNote === "string" ? b.preferenceNote : undefined,
    birthday: typeof b.birthday === "string" ? b.birthday : undefined,
    anniversary: typeof b.anniversary === "string" ? b.anniversary : undefined,
    isDefault: typeof b.isDefault === "boolean" ? b.isDefault : undefined,
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUserFromRequest(request);
    const { id } = await context.params;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体", 400);
    }

    const input = parsePatchBody(raw);
    const result = await updateMiniProgramRecipient(user.id, id, input);

    return jsonWechatSuccess({
      relationId: result.id,
      recipientId: result.recipient.id,
      name: result.recipient.name,
      phone: result.recipient.phone,
      address: result.recipient.address,
      relationType: result.relationType,
      relationLabel: result.relationLabel,
      isDefault: result.isDefault,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新收花人失败";
    const status = message.includes("未登录")
      ? 401
      : message.includes("不存在")
        ? 404
        : 400;
    return jsonError(message, status);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUserFromRequest(request);
    const { id } = await context.params;
    const result = await deleteMiniProgramRecipient(user.id, id);

    safeLogAudit({
      actorId: user.id,
      actorName: "小程序用户",
      module: AuditModule.CRM,
      action: "RECIPIENT_DELETE",
      entityType: "CustomerRecipientRelation",
      entityId: id,
      summary: `删除常用收花人`,
    });

    return jsonWechatSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除收花人失败";
    const status = message.includes("未登录")
      ? 401
      : message.includes("不存在")
        ? 404
        : 400;
    return jsonError(message, status);
  }
}
