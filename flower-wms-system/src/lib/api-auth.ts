import { Role } from "@/generated/prisma/enums";
import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { permissionDeniedResponse } from "@/lib/business-errors";
import {
  canAccessBusinessData,
  hasPermission,
  type ApiPermission,
} from "@/lib/rbac";

export type StaffSession = {
  id: string;
  username: string;
  role: Role;
};

export async function getStaffSession(): Promise<StaffSession | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role) return null;
  return {
    id: session.user.id,
    username: session.user.username,
    role: session.user.role,
  };
}

export async function requireStaffSession(): Promise<
  StaffSession | Response
> {
  const staff = await getStaffSession();
  if (!staff) {
    return jsonError("未登录或会话已过期", 401);
  }
  return staff;
}

export async function requirePermission(
  permission: ApiPermission
): Promise<StaffSession | Response> {
  const staff = await requireStaffSession();
  if (staff instanceof Response) return staff;

  if (!canAccessBusinessData(staff.role) && permission !== "staff:manage") {
    return permissionDeniedResponse("IT 运维账号无权访问业务数据");
  }

  if (!hasPermission(staff.role, permission)) {
    return permissionDeniedResponse();
  }

  return staff;
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}
