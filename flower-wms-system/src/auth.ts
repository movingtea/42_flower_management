import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const username =
          typeof credentials?.username === "string"
            ? credentials.username.trim()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!username || !password) return null;

        const staff = await prisma.staffUser.findUnique({
          where: { username },
        });
        if (!staff || !staff.isActive) return null;

        const ok = await bcrypt.compare(password, staff.passwordHash);
        if (!ok) return null;

        return {
          id: staff.id,
          name: staff.displayName ?? staff.username,
          email: staff.username,
          username: staff.username,
          role: staff.role as Role,
        };
      },
    }),
  ],
});
