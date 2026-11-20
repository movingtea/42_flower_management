/**
 * Canonical V2 WMS role, capability and navigation definition.
 *
 * This module is intentionally free of server-only imports so both the
 * authorization boundary (`src/v2/auth.ts`) and the client sidebar consume the
 * exact same matrix. Hiding a navigation item is never an authorization check;
 * server code must still call `rolesHaveCapability`/`requireV2Store`.
 */

export const V2_ROLES = [
  "ADMIN",
  "MANAGER",
  "INVENTORY_REVIEWER",
  "BUYER",
  "SALES",
  "FLORIST",
] as const;

export type V2Role = (typeof V2_ROLES)[number];

export const V2_ROLE_LABELS: Readonly<Record<V2Role, string>> = {
  ADMIN: "管理员",
  MANAGER: "门店经理",
  INVENTORY_REVIEWER: "库存复核员",
  BUYER: "采购人员",
  SALES: "订单履约人员",
  FLORIST: "花艺师",
};

export const V2_CAPABILITIES = [
  "read",
  "catalog",
  "purchase",
  "order",
  "production",
  "delivery",
  "staff",
  "inventory_review",
] as const;

export type V2Capability = (typeof V2_CAPABILITIES)[number];

export const V2_CAPABILITY_DENIED_MESSAGE = "当前账号没有此操作权限";

/**
 * Stable authorization failure shared by server-rendered pages and actions.
 *
 * Observability classifies the public `PERMISSION_DENIED` code as an expected
 * access-control outcome, so a rejected request is not reported as a system
 * outage. Keep the message user-facing and avoid attaching role details.
 */
export class V2PermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED" as const;

  constructor() {
    super(V2_CAPABILITY_DENIED_MESSAGE);
    this.name = "V2PermissionDeniedError";
  }
}

/**
 * The one capability matrix. `staff` is intentionally ADMIN-only so staff
 * administration can never be delegated by navigation visibility alone.
 */
export const V2_ROLE_CAPABILITIES: Readonly<
  Record<V2Role, readonly V2Capability[]>
> = {
  ADMIN: [...V2_CAPABILITIES],
  MANAGER: ["read", "catalog", "purchase", "order", "production", "delivery", "inventory_review"],
  INVENTORY_REVIEWER: ["read", "purchase", "inventory_review"],
  BUYER: ["read", "purchase"],
  SALES: ["read", "order", "delivery"],
  FLORIST: ["read", "production"],
};

export function isV2Role(value: unknown): value is V2Role {
  return typeof value === "string" && (V2_ROLES as readonly string[]).includes(value);
}

/**
 * Normalize persisted membership roles by trimming and dropping unknown values.
 * Unknown legacy values are ignored rather than granted implicitly.
 */
export function normalizeV2Roles(roles: readonly string[]): V2Role[] {
  const present = new Set<string>();
  for (const role of roles) {
    if (typeof role !== "string") continue;
    const trimmed = role.trim();
    if (isV2Role(trimmed)) present.add(trimmed);
  }
  return V2_ROLES.filter((role) => present.has(role));
}

/** Union of capabilities for the supplied roles, in canonical order. */
export function capabilitiesForRoles(
  roles: readonly string[]
): V2Capability[] {
  const granted = new Set<V2Capability>();
  for (const role of normalizeV2Roles(roles)) {
    for (const capability of V2_ROLE_CAPABILITIES[role]) {
      granted.add(capability);
    }
  }
  return V2_CAPABILITIES.filter((capability) => granted.has(capability));
}

export function rolesHaveCapability(
  roles: readonly string[],
  capability: V2Capability
): boolean {
  return capabilitiesForRoles(roles).includes(capability);
}

/** True when the roles grant at least one of the supplied capabilities. */
export function rolesHaveAnyCapability(
  roles: readonly string[],
  capabilities: readonly V2Capability[]
): boolean {
  if (capabilities.length === 0) return false;
  const granted = capabilitiesForRoles(roles);
  return capabilities.some((capability) => granted.includes(capability));
}

export function assertV2Capability(
  roles: readonly string[],
  capability: V2Capability
): void {
  if (!rolesHaveCapability(roles, capability)) {
    throw new V2PermissionDeniedError();
  }
}

export function assertV2AnyCapability(
  roles: readonly string[],
  capabilities: readonly V2Capability[]
): void {
  if (!rolesHaveAnyCapability(roles, capabilities)) {
    throw new V2PermissionDeniedError();
  }
}

export type V2NavItem = {
  label: string;
  href: string;
  icon: string;
  /** Any one of these capabilities makes the item visible. */
  anyCapabilities: readonly V2Capability[];
  /** Defaults to prefix matching; `exact` is used for the dashboard root. */
  activeMatch?: "exact" | "prefix";
};

export type V2NavGroup = {
  title: string;
  items: V2NavItem[];
};

/**
 * Grouped V2 navigation. Every item is filtered from the canonical matrix by
 * `getVisibleV2NavGroups`; this array is never rendered unfiltered.
 */
export const V2_NAV_GROUPS: readonly V2NavGroup[] = [
  {
    title: "经营概览",
    items: [
      {
        href: "/v2",
        label: "首页",
        icon: "📊",
        anyCapabilities: ["read"],
        activeMatch: "exact",
      },
    ],
  },
  {
    title: "库存与采购",
    items: [
      {
        href: "/v2/materials",
        label: "花材母表",
        icon: "🌸",
        anyCapabilities: ["catalog"],
      },
      {
        href: "/v2/consumables",
        label: "耗材母表",
        icon: "🧴",
        anyCapabilities: ["catalog"],
      },
      {
        href: "/v2/material-categories",
        label: "原材料分类",
        icon: "🗂️",
        anyCapabilities: ["catalog"],
      },
      {
        href: "/v2/inventory",
        label: "库存管理",
        icon: "📦",
        anyCapabilities: ["catalog", "purchase"],
      },
      {
        href: "/v2/operations",
        label: "仓储日常",
        icon: "📥",
        anyCapabilities: ["purchase"],
      },
      {
        href: "/v2/purchase-orders",
        label: "采购单",
        icon: "🧾",
        anyCapabilities: ["purchase"],
      },
      {
        href: "/v2/receiving",
        label: "采购收货",
        icon: "✅",
        anyCapabilities: ["purchase"],
      },
      {
        href: "/v2/suppliers",
        label: "供应商",
        icon: "🚚",
        anyCapabilities: ["purchase"],
      },
    ],
  },
  {
    title: "商品与成本",
    items: [
      {
        href: "/v2/catalog",
        label: "商品与 SKU",
        icon: "🛍️",
        anyCapabilities: ["catalog"],
      },
      {
        href: "/v2/recipes",
        label: "标准配方",
        icon: "🧪",
        anyCapabilities: ["catalog"],
      },
      {
        href: "/v2/packaging-kits",
        label: "包装方案",
        icon: "🎁",
        anyCapabilities: ["catalog"],
      },
      {
        href: "/v2/samples",
        label: "样品库",
        icon: "🌷",
        anyCapabilities: ["catalog"],
      },
      {
        href: "/v2/sample-plans",
        label: "打样计划",
        icon: "🧵",
        anyCapabilities: ["production"],
      },
    ],
  },
  {
    title: "客户与订单",
    items: [
      {
        href: "/v2/orders",
        label: "订单履约",
        icon: "📋",
        anyCapabilities: ["order", "production", "delivery"],
      },
    ],
  },
  {
    title: "运营保障",
    items: [
      {
        href: "/v2/reports",
        label: "报表中心",
        icon: "📈",
        anyCapabilities: ["read"],
      },
      {
        href: "/v2/sample-reports",
        label: "样品报表",
        icon: "📊",
        anyCapabilities: ["read"],
      },
      {
        href: "/v2/setup",
        label: "试运营检查",
        icon: "🚦",
        anyCapabilities: ["read"],
      },
      {
        href: "/v2/data-quality",
        label: "数据质量",
        icon: "🧹",
        anyCapabilities: ["inventory_review"],
      },
      {
        href: "/v2/system-health",
        label: "系统健康",
        icon: "🩺",
        anyCapabilities: ["staff"],
      },
      {
        href: "/v2/audit",
        label: "操作日志",
        icon: "🧾",
        anyCapabilities: ["staff"],
      },
    ],
  },
  {
    title: "系统设置",
    items: [
      {
        href: "/v2/staff",
        label: "员工与权限",
        icon: "🔐",
        anyCapabilities: ["staff"],
      },
    ],
  },
];

export function canAccessV2NavItem(
  roles: readonly string[],
  item: V2NavItem
): boolean {
  return item.anyCapabilities.some((capability) =>
    rolesHaveCapability(roles, capability)
  );
}

export function getVisibleV2NavGroups(
  roles: readonly string[]
): V2NavGroup[] {
  return V2_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccessV2NavItem(roles, item)),
  })).filter((group) => group.items.length > 0);
}

export function isV2NavItemActive(pathname: string, item: V2NavItem): boolean {
  if (item.activeMatch === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * True when a destination (including query/hash deep links) belongs to a module
 * the current roles can see. Callers still enforce authorization on the target.
 */
export function canOpenV2Href(roles: readonly string[], href: string): boolean {
  const path = href.split(/[?#]/)[0];
  return getVisibleV2NavGroups(roles).some((group) =>
    group.items.some((item) => item.activeMatch === "exact"
      ? path === item.href
      : path === item.href || path.startsWith(`${item.href}/`)),
  );
}

/** Flat list for tests and path lookups. */
export function getAllV2NavItems(): V2NavItem[] {
  return V2_NAV_GROUPS.flatMap((group) => group.items);
}
