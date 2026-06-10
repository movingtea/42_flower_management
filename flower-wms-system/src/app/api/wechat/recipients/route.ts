import { RecipientRelationType } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { requireUserFromRequest } from "@/lib/wechat-auth-request";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import {
  createMiniProgramRecipient,
  listMiniProgramRecipients,
} from "@/services/crm";

export const dynamic = "force-dynamic";

function parseRelationType(
  value: string | null | undefined
): RecipientRelationType | null {
  if (!value) return null;
  if (
    Object.values(RecipientRelationType).includes(value as RecipientRelationType)
  ) {
    return value as RecipientRelationType;
  }
  return null;
}

function parseCreateBody(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const b = raw as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new Error("请填写收花人姓名");

  return {
    name,
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

export async function GET(request: Request) {
  try {
    const user = await requireUserFromRequest(request);
    const data = await listMiniProgramRecipients(user.id);
    return jsonWechatSuccess(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "查询收花人失败";
    const status = message.includes("未登录") ? 401 : 500;
    return jsonError(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUserFromRequest(request);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体", 400);
    }

    const input = parseCreateBody(raw);
    const result = await createMiniProgramRecipient(user.id, input);

    return jsonWechatSuccess(
      {
        relationId: result.relation.id,
        recipientId: result.recipient.id,
        name: result.recipient.name,
        phone: result.recipient.phone,
        address: result.recipient.address,
        relationType: result.relation.relationType,
        relationLabel: result.relation.relationLabel,
        isDefault: result.relation.isDefault,
      },
      201
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "创建收花人失败";
    const status = message.includes("未登录")
      ? 401
      : message.includes("请填写")
        ? 400
        : 500;
    return jsonError(message, status);
  }
}
