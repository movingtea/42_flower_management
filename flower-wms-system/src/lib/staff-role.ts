/** 五级后台角色（数字越大权限越高） */
export const StaffRole = {
  VIEWER: "VIEWER",
  STORE_OPERATOR: "STORE_OPERATOR",
  STORE_MANAGER: "STORE_MANAGER",
  WMS_OPERATOR: "WMS_OPERATOR",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const;

export type StaffRoleName = (typeof StaffRole)[keyof typeof StaffRole];

export type StaffPermission = StaffRoleName;

const VALID_ROLES = new Set<string>(Object.values(StaffRole));

export function isStaffRoleName(value: string): value is StaffRoleName {
  return VALID_ROLES.has(value);
}
