/**
 * 后台 /api/admin/* 路由权限矩阵（静态审计 + smoke 用）。
 * Middleware 仅证明已登录；handler 内 requirePermission 才是权限边界。
 */
import type { ApiPermission } from "@/lib/rbac";

export type AdminRoutePermissionSpec = {
  /** 相对 src/app/api/admin/ 的路径 */
  file: string;
  method: string;
  permission: ApiPermission;
  /** 本轮 Batch A 审计修复 */
  fixedInBatchA?: boolean;
  /** Batch A.2：410 stub 权限一致化 */
  fixedInBatchA2?: boolean;
  notes?: string;
};

/** 审计指出的高风险路由 + 本轮同步补齐的相邻缺口 */
export const ADMIN_ROUTE_PERMISSION_MATRIX: AdminRoutePermissionSpec[] = [
  {
    file: "products/route.ts",
    method: "POST",
    permission: "cms:write",
    fixedInBatchA: true,
  },
  {
    file: "products/[id]/route.ts",
    method: "PUT",
    permission: "cms:write",
    fixedInBatchA: true,
  },
  {
    file: "products/[id]/route.ts",
    method: "DELETE",
    permission: "cms:write",
    fixedInBatchA: true,
  },
  {
    file: "stocktake/route.ts",
    method: "POST",
    permission: "wms:write",
    fixedInBatchA: true,
  },
  {
    file: "app-config/route.ts",
    method: "GET",
    permission: "cms:read",
    fixedInBatchA: true,
  },
  {
    file: "app-config/route.ts",
    method: "PUT",
    permission: "cms:write",
    fixedInBatchA: true,
  },
  {
    file: "product-categories/route.ts",
    method: "GET",
    permission: "cms:read",
    fixedInBatchA: true,
  },
  {
    file: "product-categories/route.ts",
    method: "POST",
    permission: "cms:write",
    fixedInBatchA: true,
  },
  {
    file: "product-categories/[id]/route.ts",
    method: "PUT",
    permission: "cms:write",
    fixedInBatchA: true,
  },
  {
    file: "product-categories/[id]/route.ts",
    method: "DELETE",
    permission: "cms:write",
    fixedInBatchA: true,
  },
  {
    file: "wms/material-categories/[id]/route.ts",
    method: "PUT",
    permission: "wms:write",
    fixedInBatchA: true,
  },
  {
    file: "wms/material-categories/[id]/route.ts",
    method: "DELETE",
    permission: "wms:write",
    fixedInBatchA: true,
  },
  {
    file: "master-parts/route.ts",
    method: "GET",
    permission: "wms:read",
    notes: "Batch P2 MasterPart 列表",
  },
  {
    file: "master-parts/route.ts",
    method: "POST",
    permission: "wms:write",
    notes: "Batch P2 MasterPart 创建",
  },
  {
    file: "master-parts/[id]/route.ts",
    method: "GET",
    permission: "wms:read",
    notes: "Batch P2 MasterPart 详情",
  },
  {
    file: "master-parts/[id]/route.ts",
    method: "PUT",
    permission: "wms:write",
    notes: "Batch P2 MasterPart 更新",
  },
  {
    file: "master-parts/[id]/route.ts",
    method: "PATCH",
    permission: "wms:write",
    notes: "Batch P2 MasterPart 更新",
  },
  {
    file: "master-parts/[id]/route.ts",
    method: "DELETE",
    permission: "wms:write",
    notes: "Batch P2 MasterPart 停用",
  },
  {
    file: "orders/[id]/detail/route.ts",
    method: "GET",
    permission: "wms:read",
    fixedInBatchA: true,
    notes: "订单履约详情；Florist / Store Admin 可读",
  },
  {
    file: "products/bom/route.ts",
    method: "GET",
    permission: "wms:read",
    fixedInBatchA: true,
    notes: "deprecated 只读",
  },
  {
    file: "products/[id]/bom/route.ts",
    method: "GET",
    permission: "wms:read",
    fixedInBatchA: true,
    notes: "deprecated 只读",
  },
  {
    file: "wms/bom/route.ts",
    method: "GET",
    permission: "wms:read",
    fixedInBatchA2: true,
    notes: "deprecated returns 410",
  },
  {
    file: "wms/bom/route.ts",
    method: "POST",
    permission: "wms:write",
    fixedInBatchA2: true,
    notes: "deprecated returns 410",
  },
  {
    file: "products/bom/route.ts",
    method: "POST",
    permission: "wms:write",
    fixedInBatchA2: true,
    notes: "deprecated returns 410",
  },
  {
    file: "products/[id]/bom/route.ts",
    method: "PUT",
    permission: "wms:write",
    fixedInBatchA2: true,
    notes: "deprecated returns 410",
  },
];

/** 低权限角色不得拥有的写权限（smoke RBAC） */
export const LOW_PRIVILEGE_WRITE_DENY: Array<{
  role: "FLORIST" | "WAREHOUSE_MANAGER" | "STORE_OPERATOR" | "IT_ADMIN";
  permission: ApiPermission;
}> = [
  { role: "FLORIST", permission: "cms:write" },
  { role: "FLORIST", permission: "wms:write" },
  { role: "WAREHOUSE_MANAGER", permission: "cms:write" },
  { role: "STORE_OPERATOR", permission: "wms:write" },
  { role: "IT_ADMIN", permission: "cms:write" },
  { role: "IT_ADMIN", permission: "wms:write" },
  { role: "IT_ADMIN", permission: "business:read" },
];
