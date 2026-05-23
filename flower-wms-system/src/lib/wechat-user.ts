import type { User } from "@/generated/prisma/client";
import { resolveImageUrl } from "@/utils/imageUrlFormatter";

export type WechatUserProfile = {
  id: string;
  openId: string;
  nickName: string | null;
  avatarUrl: string | null;
  defaultReceiverName: string | null;
  defaultReceiverPhone: string | null;
  defaultAddress: string | null;
};

export function mapUserToWechatProfile(user: User): WechatUserProfile {
  return {
    id: user.id,
    openId: user.openId,
    nickName: user.nickName,
    avatarUrl: user.avatarUrl ? resolveImageUrl(user.avatarUrl) ?? user.avatarUrl : null,
    defaultReceiverName: user.defaultReceiverName,
    defaultReceiverPhone: user.defaultReceiverPhone,
    defaultAddress: user.defaultAddress,
  };
}

export function parseProfileUpdateBody(body: unknown): {
  nickName?: string | null;
  avatarUrl?: string | null;
  defaultReceiverName?: string | null;
  defaultReceiverPhone?: string | null;
  defaultAddress?: string | null;
} {
  if (!body || typeof body !== "object") {
    throw new Error("请求体无效");
  }

  const b = body as Record<string, unknown>;
  const out: {
    nickName?: string | null;
    avatarUrl?: string | null;
    defaultReceiverName?: string | null;
    defaultReceiverPhone?: string | null;
    defaultAddress?: string | null;
  } = {};

  if ("nickName" in b) {
    const v = typeof b.nickName === "string" ? b.nickName.trim() : "";
    out.nickName = v || null;
  }

  if ("avatarUrl" in b) {
    const v = typeof b.avatarUrl === "string" ? b.avatarUrl.trim() : "";
    out.avatarUrl = v || null;
  }

  if ("defaultReceiverName" in b) {
    const v =
      typeof b.defaultReceiverName === "string"
        ? b.defaultReceiverName.trim()
        : "";
    out.defaultReceiverName = v || null;
  }

  if ("defaultReceiverPhone" in b) {
    const v =
      typeof b.defaultReceiverPhone === "string"
        ? b.defaultReceiverPhone.trim()
        : "";
    out.defaultReceiverPhone = v || null;
  }

  if ("defaultAddress" in b) {
    const v =
      typeof b.defaultAddress === "string" ? b.defaultAddress.trim() : "";
    out.defaultAddress = v || null;
  }

  return out;
}
