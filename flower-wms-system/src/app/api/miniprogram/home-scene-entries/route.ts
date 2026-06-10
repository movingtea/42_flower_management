import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { listActiveHomeSceneEntriesForMiniProgram } from "@/services/cms-home-scene-entries";

export const dynamic = "force-dynamic";

/** GET：小程序首页场景入口 */
export async function GET() {
  try {
    const result = await listActiveHomeSceneEntriesForMiniProgram();
    return jsonWechatSuccess(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "场景入口加载失败";
    return jsonError(message, 500);
  }
}
