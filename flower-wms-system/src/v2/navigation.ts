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
  "BUYER",
  "SALES",
  "FLORIST",
] as const;

export type V2Role = (typeof V2_ROLES)[number];

export const V2_ROLE_LABELS: Readonly<Record<V2Role, string>> = {
  ADMIN: "管理员",
  MANAGER: "门店经理",
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
] as const;

export type V2Capability = (typeof V2_CAPABILITIES)[number];

export const V2_CAPABILITY_DENIED_MESSAGE = "当前账号没有此操作权限";

/**
 * The one capability matrix. `staff` is intentionally ADMIN-only so staff
 * administration can never be delegated by navigation visibility alone.
 */
export const V2_ROLE_CAPABILITIES: Readonly<
  Record<V2Role, readonly V2Capability[]>
> = {
  ADMIN: [...V2_CAPABILITIES],
  MANAGER: ["read", "catalog", "purchase", "order", "production", "delivery"],
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
    throw new Error(V2_CAPABILITY_DENIED_MESSAGE);
  }
}

export function assertV2AnyCapability(
  roles: readonly string[],
  capabilities: readonly V2Capability[]
): void {
  if (!rolesHaveAnyCapability(roles, capabilities)) {
    throw new Error(V2_CAPABILITY_DENIED_MESSAGE);
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
        label: "物料母表",
        icon: "🌸",
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

/** Flat list for tests and path lookups. */
export function getAllV2NavItems(): V2NavItem[] {
  return V2_NAV_GROUPS.flatMap((group) => group.items);
}
