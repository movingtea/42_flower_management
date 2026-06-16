import type { NextAuthConfig } from "next-auth";
import { Role } from "@/generated/prisma/enums";

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
