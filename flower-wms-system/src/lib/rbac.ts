import { Role } from "@/generated/prisma/enums";

export type StaffRole = Role;

/** IT Admin 严禁访问任何业务数据 API */
export function canAccessBusinessData(role: StaffRole): boolean {
  return role !== Role.IT_ADMIN;
}

export function canManageStaffUsers(role: StaffRole): boolean {
  return role === Role.IT_ADMIN || role === Role.STORE_ADMIN;
}

/** 大仓写：入库、报损、Wiki 维护、配方审定 */
export function canWmsWrite(role: StaffRole): boolean {
  return role === Role.STORE_ADMIN || role === Role.WAREHOUSE_MANAGER;
}

/** Wiki / 标准配方只读（Florist） */
export function canWmsReadWikiAndRecipe(role: StaffRole): boolean {
  return (
    canWmsWrite(role) ||
    role === Role.FLORIST ||
    role === Role.STORE_OPERATOR
  );
}

/** CMS 商品/运营写 */
export function canCmsWrite(role: StaffRole): boolean {
  return role === Role.STORE_ADMIN || role === Role.STORE_OPERATOR;
}

/** 订单履约看板（Florist 触发 FIFO 销售出库） */
export function canOperateOrders(role: StaffRole): boolean {
  return role === Role.STORE_ADMIN || role === Role.FLORIST;
}

/** 全量损耗审计日志 */
export function canViewLossAudit(role: StaffRole): boolean {
  return role === Role.STORE_ADMIN || role === Role.WAREHOUSE_MANAGER;
}

export function canViewWmsDashboard(role: StaffRole): boolean {
  return role !== Role.IT_ADMIN && role !== Role.STORE_OPERATOR;
}

export type ApiPermission =
  | "business:read"
  | "business:write"
  | "wms:write"
  | "wms:read"
  | "cms:write"
  | "cms:read"
  | "orders:write"
  | "loss:audit"
  | "staff:manage";

export function hasAnyPermission(
  role: StaffRole,
  permissions: ApiPermission[]
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function hasPermission(role: StaffRole, permission: ApiPermission): boolean {
  switch (permission) {
    case "staff:manage":
      return canManageStaffUsers(role);
    case "business:read":
      return canAccessBusinessData(role);
    case "business:write":
      return canWmsWrite(role) || canCmsWrite(role) || canOperateOrders(role);
    case "wms:write":
      return canWmsWrite(role);
    case "wms:read":
      return canWmsReadWikiAndRecipe(role) || canViewWmsDashboard(role);
    case "cms:write":
      return canCmsWrite(role);
    case "cms:read":
      return canCmsWrite(role) || role === Role.STORE_ADMIN;
    case "orders:write":
      return canOperateOrders(role);
    case "loss:audit":
      return canViewLossAudit(role);
    default:
      return false;
  }
}

/** 业务 API 路径前缀（供 Middleware 识别 IT Admin 盲区） */
export const BUSINESS_API_PREFIXES = [
  "/api/admin/wms",
  "/api/admin/wiki",
  "/api/admin/orders",
  "/api/admin/reports",
  "/api/admin/crm",
  "/api/admin/batches",
  "/api/admin/wastage",
  "/api/admin/stocktake",
  "/api/admin/products",
  "/api/admin/banners",
  "/api/admin/cms",
  "/api/admin/product-categories",
  "/api/admin/categories",
  "/api/admin/setup",
  "/api/admin/data-quality",
  "/api/admin/system",
  "/api/admin/trial-run",
  "/api/admin/audit-logs",
  "/api/cms",
  "/api/business",
] as const;

export function isBusinessApiPath(pathname: string): boolean {
  return BUSINESS_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export function isStaffAdminApiPath(pathname: string): boolean {
  return (
    pathname === "/api/admin/staff-users" ||
    pathname.startsWith("/api/admin/staff-users/")
  );
}
