import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  authConfig,
  LEGACY_CREDENTIALS_PROVIDER_ID,
  V2_CREDENTIALS_PROVIDER_ID,
} from "@/auth.config";
import { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { resolveStaffTenantContext } from "@/services/tenant";

type CredentialsInput = Partial<Record<"username" | "password", unknown>>;

function readCredentials(credentials: CredentialsInput | undefined) {
  return {
    username:
      typeof credentials?.username === "string"
        ? credentials.username.trim()
        : "",
    password:
      typeof credentials?.password === "string" ? credentials.password : "",
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: LEGACY_CREDENTIALS_PROVIDER_ID,
      name: "Credentials",
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const { username, password } = readCredentials(credentials);

        if (!username || !password) return null;

        const staff = await prisma.staffUser.findUnique({
          where: { username },
        });
        if (!staff || !staff.isActive) return null;

        const ok = await bcrypt.compare(password, staff.passwordHash);
        if (!ok) return null;

        const tenantContext = await resolveStaffTenantContext(
          staff.id,
          staff.role as Role
        );

        return {
          id: staff.id,
          name: staff.displayName ?? staff.username,
          email: staff.username,
          username: staff.username,
          role: staff.role as Role,
          source: "legacy",
          defaultTenantId: tenantContext.defaultTenantId,
          currentTenantId: tenantContext.currentTenantId,
          tenantRole: tenantContext.tenantRole,
        };
      },
    }),
    Credentials({
      id: V2_CREDENTIALS_PROVIDER_ID,
      name: "V2 Credentials",
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const { username, password } = readCredentials(credentials);
        if (!username || !password) return null;

        // Load the v2 stack lazily so a missing/broken V2_DATABASE_URL never
        // breaks the still-active legacy login provider.
        const [{ authenticateV2Staff }, { v2db }] = await Promise.all([
          import("@/v2/auth"),
          import("@/v2/db"),
        ]);

        const principal = await authenticateV2Staff(
          { username, password },
          (candidateUsername) =>
            v2db.staffUser.findUnique({
              where: { username: candidateUsername },
              include: {
                tenantMembers: true,
                storeMembers: { include: { store: true } },
              },
            })
        );
        if (!principal) return null;

        return {
          id: principal.id,
          name: principal.displayName ?? principal.username,
          email: principal.username,
          username: principal.username,
          role: principal.sessionRole,
          source: "v2",
          v2BootstrapSession: principal.mustChangePassword,
          defaultTenantId: null,
          currentTenantId: null,
          tenantRole: null,
        };
      },
    }),
  ],
});
