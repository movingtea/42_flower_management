import { extractBearerToken } from "@/lib/wechat-auth-request";
import { verifyStaffToken } from "@/lib/staff-jwt";
import {
  isStaffRoleName,
  StaffRole,
  type StaffPermission,
  type StaffRoleName,
} from "@/lib/staff-role";

export { StaffRole, type StaffPermission, type StaffRoleName } from "@/lib/staff-role";

const ROLE_RANK: Record<StaffRoleName, number> = {
  [StaffRole.VIEWER]: 1,
  [StaffRole.STORE_OPERATOR]: 2,
  [StaffRole.STORE_MANAGER]: 3,
  [StaffRole.WMS_OPERATOR]: 4,
  [StaffRole.SUPER_ADMIN]: 5,
};

export type StaffSession = {
  staffId: string;
  role: StaffRoleName;
};

export class ForbiddenError extends Error {
  constructor(message = "无权访问") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function hasMinimumRole(
  actual: StaffRoleName,
  required: StaffPermission
): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** 从 Authorization Bearer 解析员工会话，失败返回 null */
export function getStaffFromRequest(request: Request): StaffSession | null {
  const token = extractBearerToken(request);
  if (!token) return null;

  const payload = verifyStaffToken(token);
  if (!payload || !isStaffRoleName(payload.role)) {
    return null;
  }

  return { staffId: payload.sub, role: payload.role };
}

/**
 * RBAC 门禁：不具备 `minimum` 及以上角色的请求一律 403。
 * 须在 Route Handler 最顶层调用。
 */
export async function requirePermission(
  request: Request,
  minimum: StaffPermission
): Promise<StaffSession> {
  const staff = getStaffFromRequest(request);
  if (!staff) {
    throw new ForbiddenError("未登录或会话已失效");
  }
  if (!hasMinimumRole(staff.role, minimum)) {
    throw new ForbiddenError("权限不足");
  }
  return staff;
}
