import { jsonError } from "@/lib/api";
import {
  isMiniprogramBusinessError,
  type MiniprogramErrorCode,
} from "@/lib/miniprogram-business-error";
import { jsonWechatError, jsonWechatSuccess } from "@/lib/wechat-api";
import {
  buildCartLines,
  parseCartClientItems,
  validateCartAdd,
} from "@/lib/cart.server";

export const dynamic = "force-dynamic";

async function handleCartRequest(itemsRaw: unknown) {
  const clientItems = parseCartClientItems(itemsRaw);
  const list = await buildCartLines(clientItems);
  return jsonWechatSuccess({ list, total: list.length });
}

async function handleValidateAdd(body: Record<string, unknown>) {
  const spuId = typeof body.spuId === "string" ? body.spuId.trim() : "";
  const skuId = typeof body.skuId === "string" ? body.skuId.trim() : "";
  const quantity = Number(body.quantity);

  if (!spuId) return jsonError("spuId 不能为空", 400);
  if (!skuId) return jsonError("skuId 不能为空", 400);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return jsonError("quantity 须为正整数", 400);
  }

  const existingItems = parseCartClientItems(body.existingItems ?? []);

  const result = await validateCartAdd({
    spuId,
    skuId,
    quantity,
    existingItems,
  });

  if (!result.ok) {
    const code =
      result.code && result.code !== "SELECT_SPEC"
        ? (result.code as MiniprogramErrorCode)
        : undefined;
    return jsonWechatError(result.message ?? "库存不足", 400, code);
  }

  return jsonWechatSuccess({
    ok: true,
    availableStock: result.availableStock ?? 0,
  });
}

/** GET：校验购物车（query: items=JSON 编码的 [{ productId, quantity }]） */
export async function GET(request: Request) {
  try {
    const itemsParam = new URL(request.url).searchParams.get("items");
    if (!itemsParam) {
      return jsonWechatSuccess({ list: [], total: 0 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(itemsParam);
    } catch {
      return jsonError("items 参数须为合法 JSON", 400);
    }

    return handleCartRequest(parsed);
  } catch (err) {
    if (isMiniprogramBusinessError(err)) {
      return jsonWechatError(err.message, 400, err.code);
    }
    const message = err instanceof Error ? err.message : "购物车加载失败";
    return jsonError(message, 400);
  }
}

/** POST：校验购物车或加入购物车前库存校验 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (body.action === "validate-add") {
      return handleValidateAdd(body);
    }

    return handleCartRequest(body.items ?? []);
  } catch (err) {
    if (isMiniprogramBusinessError(err)) {
      return jsonWechatError(err.message, 400, err.code);
    }
    const message = err instanceof Error ? err.message : "购物车加载失败";
    return jsonError(message, 400);
  }
}
