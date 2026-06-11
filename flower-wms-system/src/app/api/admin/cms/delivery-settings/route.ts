import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import {
  defaultStoreDeliverySettings,
  parseStoreDeliverySettings,
  validateStoreDeliverySettings,
  type StoreDeliverySettings,
} from "@/lib/store-delivery-settings";
import {
  getStoreDeliverySettings,
  saveStoreDeliverySettings,
} from "@/services/store-delivery-settings";

export const dynamic = "force-dynamic";

function parseBody(raw: unknown): StoreDeliverySettings {
  if (!raw || typeof raw !== "object") {
    return defaultStoreDeliverySettings();
  }
  return parseStoreDeliverySettings(raw);
}

export async function GET() {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const settings = await getStoreDeliverySettings();
    return jsonSuccess({ settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "获取配送设置失败";
    return jsonError(message, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const staff = await requirePermission("cms:write");
    if (isResponse(staff)) return staff;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体", 400);
    }

    const body = parseBody(
      raw && typeof raw === "object" && "settings" in (raw as object)
        ? (raw as { settings: unknown }).settings
        : raw
    );
    const validationError = validateStoreDeliverySettings(body);
    if (validationError) {
      return jsonError(validationError, 400);
    }

    const settings = await saveStoreDeliverySettings(body);
    return jsonSuccess({ settings, message: "配送设置已保存" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "保存配送设置失败";
    return jsonError(message, 500);
  }
}
