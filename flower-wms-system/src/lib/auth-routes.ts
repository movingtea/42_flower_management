import { Role } from "@/generated/prisma/enums";

/** 需员工登录才可访问的页面路径（不含 /login、不含微信等公开 API） */
export function isStaffProtectedPage(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/wms") ||
    pathname.startsWith("/cms") ||
    pathname.startsWith("/admin")
  );
}

/** 需员工登录才可访问的后台 API（排除 Auth.js 自身） */
export function isStaffProtectedAdminApi(pathname: string): boolean {
  if (!pathname.startsWith("/api/admin")) return false;
  if (pathname.startsWith("/api/auth")) return false;
  return true;
}

export function isStaffProtectedApi(pathname: string): boolean {
  return (
    isStaffProtectedAdminApi(pathname) ||
    pathname.startsWith("/api/cms") ||
    pathname.startsWith("/api/business")
  );
}

export function isStaffProtectedPath(pathname: string): boolean {
  return isStaffProtectedPage(pathname) || isStaffProtectedApi(pathname);
}

/** 登录后默认落地页（按角色） */
export function getRoleHomePath(role: Role): string {
  switch (role) {
    case Role.IT_ADMIN:
      return "/admin/staff-users";
    case Role.STORE_OPERATOR:
      return "/cms/products";
    case Role.FLORIST:
      return "/wms/orders";
    case Role.WAREHOUSE_MANAGER:
      return "/wms/operations";
    case Role.STORE_ADMIN:
      return "/";
    default:
      return "/";
  }
}
