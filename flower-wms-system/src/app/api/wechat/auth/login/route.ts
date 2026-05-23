import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { signWechatToken } from "@/lib/wechat-jwt";
import { exchangeCodeForOpenId } from "@/lib/wechat-session";
import { mapUserToWechatProfile } from "@/lib/wechat-user";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** POST：静默登录（wx.login code 换 openId + JWT） */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { code?: unknown };
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!code) {
      return jsonError("code 不能为空", 400);
    }

    const { openId } = await exchangeCodeForOpenId(code);

    const user = await prisma.user.upsert({
      where: { openId },
      create: { openId },
      update: {},
    });

    const token = signWechatToken(user.id, user.openId);

    return jsonWechatSuccess({
      token,
      user: mapUserToWechatProfile(user),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "登录失败";
    const status = message.includes("未配置") ? 500 : 400;
    return jsonError(message, status);
  }
}
