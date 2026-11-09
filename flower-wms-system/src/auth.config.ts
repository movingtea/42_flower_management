import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/generated/prisma/enums";
import type { AuthSource } from "@/types/next-auth";

export const V2_CREDENTIALS_PROVIDER_ID = "v2-credentials";
export const LEGACY_CREDENTIALS_PROVIDER_ID = "credentials";
export const V2_HOME_PATH = "/v2";

/** Sessions created before the source marker existed are legacy sessions. */
export function normalizeAuthSource(value: unknown): AuthSource {
  return value === "v2" ? "v2" : "legacy";
}

/** Only accept internal callback paths; never allow an absolute/open redirect. */
export function normalizeCallbackUrl(
  value: string | null | undefined,
  fallback = "/"
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  try {
    const url = new URL(value, "http://localhost");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function isV2Path(pathname: string): boolean {
  return pathname === V2_HOME_PATH || pathname.startsWith(`${V2_HOME_PATH}/`);
}

export function isV2CallbackUrl(value: string | null | undefined): boolean {
  const path = normalizeCallbackUrl(value, "");
  return isV2Path(path.split(/[?#]/, 1)[0]);
}

/** The default login target is the v2 workbench; "/" is the v2 entry too. */
export function resolveLoginCallbackUrl(
  value: string | null | undefined
): string {
  const callbackUrl = normalizeCallbackUrl(value, V2_HOME_PATH);
  return callbackUrl === "/" ? V2_HOME_PATH : callbackUrl;
}

export type LoginSurface = "v2" | "legacy";

/**
 * Login without a callback (or with a v2/root callback) uses v2 credentials.
 * Any other explicit internal callback is an intentional legacy login.
 */
export function resolveLoginSurface(
  value: string | null | undefined
): LoginSurface {
  if (!value) return "v2";
  const callbackUrl = resolveLoginCallbackUrl(value);
  return isV2Path(callbackUrl.split(/[?#]/, 1)[0]) ? "v2" : "legacy";
}

export type LoginRedirectDecision =
  | { kind: "render" }
  | { kind: "redirect"; destination: string };

/**
 * Decide whether the login page can render. Explicit legacy callbacks always
 * render so an existing v2 or legacy session can switch credential sources.
 * Only a v2 session on a v2/root callback is sent straight back to v2.
 */
export function resolveLoginRedirect(input: {
  isLoggedIn: boolean;
  source: AuthSource;
  callbackUrl: string | null | undefined;
}): LoginRedirectDecision {
  const surface = resolveLoginSurface(input.callbackUrl);
  if (
    surface === "legacy" ||
    !input.isLoggedIn ||
    input.source !== "v2"
  ) {
    return { kind: "render" };
  }
  return {
    kind: "redirect",
    destination: resolveLoginCallbackUrl(input.callbackUrl),
  };
}

/**
 * Edge / Proxy 兼容的 Auth.js 配置（供 proxy.ts 使用）。
 * 勿在此文件引入 prisma / bcrypt — 仅 Node Route Handler 在 auth.ts 中挂载 Credentials。
 */
export const authConfig = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.role = user.role;
        token.source = normalizeAuthSource(user.source);
        token.v2BootstrapSession = user.v2BootstrapSession === true;
        token.defaultTenantId = user.defaultTenantId ?? null;
        token.currentTenantId = user.currentTenantId ?? null;
        token.tenantRole = user.tenantRole ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (
        session.user &&
        typeof token.id === "string" &&
        typeof token.username === "string" &&
        typeof token.role === "string"
      ) {
        session.user.id = token.id;
        session.user.username = token.username;
        session.user.role = token.role as Role;
        session.user.source = normalizeAuthSource(token.source);
        if (token.v2BootstrapSession === true) session.user.v2BootstrapSession = true;
        session.user.defaultTenantId =
          typeof token.defaultTenantId === "string" ? token.defaultTenantId : null;
        session.user.currentTenantId =
          typeof token.currentTenantId === "string" ? token.currentTenantId : null;
        session.user.tenantRole =
          typeof token.tenantRole === "string"
            ? (token.tenantRole as Role)
            : null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
