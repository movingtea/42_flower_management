import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { buildCartLines, parseCartClientItems } from "@/lib/cart.server";

export const dynamic = "force-dynamic";

async function handleCartRequest(itemsRaw: unknown) {
  const clientItems = parseCartClientItems(itemsRaw);
  const list = await buildCartLines(clientItems);
  return jsonWechatSuccess({ list, total: list.length });
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
    const message = err instanceof Error ? err.message : "购物车加载失败";
    return jsonError(message, 400);
  }
}

/** POST：校验购物车（body: { items: [{ productId, quantity }] }） */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { items?: unknown };
    return handleCartRequest(body.items ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : "购物车加载失败";
    return jsonError(message, 400);
  }
}
