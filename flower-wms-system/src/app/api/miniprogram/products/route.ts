import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { listMiniProgramProductsFromQuery } from "@/services/miniprogram-products";

export const dynamic = "force-dynamic";

/** GET：小程序商品列表（tag 过滤 + 分页；兼容旧无分页调用） */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const data = await listMiniProgramProductsFromQuery(params);
    return jsonWechatSuccess(data);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "商品列表加载失败";
    return jsonError(message, 500);
  }
}
