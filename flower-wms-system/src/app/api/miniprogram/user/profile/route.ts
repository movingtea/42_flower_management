import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import {
  getUserFromRequest,
  requireUserFromRequest,
} from "@/lib/wechat-auth-request";
import {
  mapUserToWechatProfile,
  parseProfileUpdateBody,
} from "@/lib/wechat-user";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET：当前登录用户资料 */
export async function GET(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return jsonError("未登录或登录已过期", 401);
    }

    return jsonWechatSuccess({ user: mapUserToWechatProfile(user) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "获取用户资料失败";
    return jsonError(message, 500);
  }
}

/** PATCH：更新昵称、头像、默认收货信息 */
export async function PATCH(request: Request) {
  try {
    const current = await requireUserFromRequest(request);
    const patch = parseProfileUpdateBody(await request.json());

    if (Object.keys(patch).length === 0) {
      return jsonError("没有可更新的字段", 400);
    }

    const user = await prisma.user.update({
      where: { id: current.id },
      data: patch,
    });

    return jsonWechatSuccess({
      message: "资料已更新",
      user: mapUserToWechatProfile(user),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新失败";
    const status =
      message.includes("未登录") || message.includes("过期")
        ? 401
        : message.includes("无效")
          ? 400
          : 500;
    return jsonError(message, status);
  }
}
