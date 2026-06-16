import type { Role } from "@/generated/prisma/enums";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: Role;
      /** 默认租户 ID（Sprint 21 地基；当前业务 API 尚未强制使用） */
      defaultTenantId: string | null;
      /** 当前租户 ID；单租户阶段与 defaultTenantId 相同 */
      currentTenantId: string | null;
      /** 租户内角色副本；当前权限仍以 StaffUser.role 为准 */
      tenantRole: Role | null;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    username: string;
    role: Role;
    defaultTenantId?: string | null;
    currentTenantId?: string | null;
    tenantRole?: Role | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    role: Role;
    defaultTenantId?: string | null;
    currentTenantId?: string | null;
    tenantRole?: Role | null;
  }
}
