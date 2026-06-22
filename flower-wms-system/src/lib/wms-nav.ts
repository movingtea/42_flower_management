import { Role } from "@/generated/prisma/enums";
import {
  canAccessBusinessData,
  hasAnyPermission,
  hasPermission,
  type ApiPermission,
} from "@/lib/rbac";

export type WmsNavItem = {
  label: string;
  href: string;
  icon: string;
  /** 必须拥有该 permission */
  permission?: ApiPermission;
  /** 拥有任意一个即可 */
  anyPermissions?: ApiPermission[];
  /** 精确匹配 active（默认对 href 精确匹配，否则 prefix） */
  activeMatch?: "exact" | "prefix";
  /** 额外 active 前缀（如 CRM 子路由） */
  activePaths?: string[];
};

export type WmsNavGroup = {
  title: string;
  items: WmsNavItem[];
};

/** WMS 左侧导航分组（顺序固定） */
export const WMS_NAV_GROUPS: WmsNavGroup[] = [
  {
    title: "经营概览",
    items: [
      {
        label: "仪表盘",
        href: "/wms/dashboard",
        icon: "📊",
        permission: "wms:read",
        activeMatch: "exact",
      },
      {
        label: "经营报表",
        href: "/wms/reports",
        icon: "📈",
        permission: "wms:read",
        activeMatch: "prefix",
      },
    ],
  },
  {
    title: "试运营与系统",
    items: [
      {
        label: "试运营准备",
        href: "/wms/setup",
        icon: "🚀",
        permission: "business:read",
        activeMatch: "exact",
      },
      {
        label: "数据质量",
        href: "/wms/data-quality",
        icon: "🔍",
        permission: "business:read",
        activeMatch: "exact",
      },
      {
        label: "系统健康",
        href: "/wms/system-health",
        icon: "💚",
        permission: "business:read",
        activeMatch: "exact",
      },
      {
        label: "操作日志",
        href: "/wms/audit-logs",
        icon: "📝",
        permission: "business:read",
        activeMatch: "exact",
      },
    ],
  },
  {
    title: "库存与采购",
    items: [
      {
        label: "库存管理",
        href: "/wms/inventory",
        icon: "📦",
        permission: "wms:read",
        activeMatch: "prefix",
      },
      {
        label: "仓储日常",
        href: "/wms/operations",
        icon: "📥",
        permission: "wms:write",
        activeMatch: "prefix",
      },
      {
        label: "采购单",
        href: "/wms/purchase-orders",
        icon: "🧾",
        anyPermissions: ["wms:read", "wms:write"],
        activeMatch: "prefix",
      },
      {
        label: "供应商",
        href: "/wms/suppliers",
        icon: "🚚",
        anyPermissions: ["wms:read", "wms:write"],
        activeMatch: "prefix",
      },
      {
        label: "物料母表",
        href: "/wms/wiki",
        icon: "🌸",
        anyPermissions: ["wms:read", "wms:write"],
        activeMatch: "prefix",
      },
      {
        label: "通用物料母表",
        href: "/wms/master-parts",
        icon: "🧰",
        anyPermissions: ["wms:read", "wms:write"],
        activeMatch: "prefix",
      },
      {
        label: "原材料分类",
        href: "/wms/material-categories",
        icon: "🏷️",
        permission: "wms:write",
        activeMatch: "prefix",
      },
    ],
  },
  {
    title: "商品与成本",
    items: [
      {
        label: "标准配方",
        href: "/wms/recipes",
        icon: "🧪",
        permission: "wms:write",
        activeMatch: "prefix",
      },
      {
        label: "包装方案",
        href: "/wms/packaging-kits",
        icon: "🎁",
        permission: "wms:write",
        activeMatch: "prefix",
      },
    ],
  },
  {
    title: "客户与订单",
    items: [
      {
        label: "订单履约",
        href: "/wms/orders",
        icon: "📋",
        permission: "orders:write",
        activeMatch: "prefix",
      },
      {
        label: "客户 CRM",
        href: "/wms/crm",
        icon: "💐",
        permission: "business:read",
        activeMatch: "prefix",
        activePaths: ["/wms/crm"],
      },
    ],
  },
];

/** 与 proxy 一致的角色级 WMS 路径限制（非 permission 可表达的特殊规则） */
export function passesWmsRolePathGate(role: Role, pathname: string): boolean {
  if (!canAccessBusinessData(role)) return false;
  if (role === Role.STORE_OPERATOR) return false;
  if (role === Role.FLORIST) {
    return (
      pathname === "/wms/orders" || pathname.startsWith("/wms/orders/")
    );
  }
  return true;
}

export function canAccessNavItem(role: Role, item: WmsNavItem): boolean {
  if (!passesWmsRolePathGate(role, item.href)) return false;

  if (item.permission) {
    return hasPermission(role, item.permission);
  }
  if (item.anyPermissions && item.anyPermissions.length > 0) {
    return hasAnyPermission(role, item.anyPermissions);
  }
  return false;
}

export function getVisibleNavGroups(role: Role): WmsNavGroup[] {
  return WMS_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccessNavItem(role, item)),
  })).filter((group) => group.items.length > 0);
}

export function isNavItemActive(pathname: string, item: WmsNavItem): boolean {
  if (item.activePaths?.length) {
    if (item.activePaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return true;
    }
  }
  if (item.activeMatch === "exact") {
    return pathname === item.href;
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

type RoutePermissionRule = {
  prefix: string;
  permission?: ApiPermission;
  anyPermissions?: ApiPermission[];
};

/** 最长前缀匹配 */
const WMS_ROUTE_PERMISSION_RULES: RoutePermissionRule[] = [
  { prefix: "/wms/dashboard", permission: "wms:read" },
  { prefix: "/wms/reports", permission: "wms:read" },
  { prefix: "/wms/setup", permission: "business:read" },
  { prefix: "/wms/data-quality", permission: "business:read" },
  { prefix: "/wms/system-health", permission: "business:read" },
  { prefix: "/wms/audit-logs", permission: "business:read" },
  { prefix: "/wms/inventory", permission: "wms:read" },
  { prefix: "/wms/operations", permission: "wms:write" },
  { prefix: "/wms/purchase-orders", anyPermissions: ["wms:read", "wms:write"] },
  { prefix: "/wms/suppliers", anyPermissions: ["wms:read", "wms:write"] },
  { prefix: "/wms/wiki", anyPermissions: ["wms:read", "wms:write"] },
  { prefix: "/wms/master-parts", anyPermissions: ["wms:read", "wms:write"] },
  { prefix: "/wms/material-categories", permission: "wms:write" },
  { prefix: "/wms/recipes", permission: "wms:write" },
  { prefix: "/wms/packaging-kits", permission: "wms:write" },
  { prefix: "/wms/orders", permission: "orders:write" },
  { prefix: "/wms/crm", permission: "business:read" },
  { prefix: "/wms/batches", permission: "wms:write" },
  { prefix: "/wms/wastage", permission: "wms:write" },
  { prefix: "/wms/bom", permission: "wms:write" },
];

export function getRequiredPermissionForWmsPath(
  pathname: string
): Pick<RoutePermissionRule, "permission" | "anyPermissions"> | null {
  let matched: RoutePermissionRule | null = null;
  for (const rule of WMS_ROUTE_PERMISSION_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      if (!matched || rule.prefix.length > matched.prefix.length) {
        matched = rule;
      }
    }
  }
  return matched;
}

export function canAccessWmsPath(role: Role, pathname: string): boolean {
  if (!pathname.startsWith("/wms")) return true;
  if (pathname === "/wms") return canAccessNavItem(role, WMS_NAV_GROUPS[0].items[0]);

  if (!passesWmsRolePathGate(role, pathname)) return false;

  const required = getRequiredPermissionForWmsPath(pathname);
  if (!required) return true;

  if (required.permission) {
    return hasPermission(role, required.permission);
  }
  if (required.anyPermissions?.length) {
    return hasAnyPermission(role, required.anyPermissions);
  }
  return false;
}

/** 扁平化所有 nav items（测试 / 查找） */
export function getAllWmsNavItems(): WmsNavItem[] {
  return WMS_NAV_GROUPS.flatMap((g) => g.items);
}
