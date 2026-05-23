import type { User } from "@/generated/prisma/client";
import { verifyWechatToken } from "@/lib/wechat-jwt";
import { prisma } from "@/lib/prisma";

export function extractBearerToken(request: Request): string | null {
  const header =
    request.headers.get("authorization") ??
    request.headers.get("Authorization");

  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/** 从 Authorization 解析当前登录用户，失败返回 null */
export async function getUserFromRequest(
  request: Request
): Promise<User | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  const payload = verifyWechatToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
  });

  if (!user || user.openId !== payload.openId) {
    return null;
  }

  return user;
}

export async function requireUserFromRequest(request: Request): Promise<User> {
  const user = await getUserFromRequest(request);
  if (!user) {
    throw new Error("未登录或登录已过期");
  }
  return user;
}
