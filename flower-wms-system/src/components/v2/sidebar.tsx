"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  V2_ROLE_LABELS,
  getVisibleV2NavGroups,
  isV2NavItemActive,
  rolesHaveCapability,
  type V2Role,
} from "@/v2/navigation";

type V2SidebarProps = {
  roles: readonly V2Role[];
  displayName: string | null;
  username: string;
};

export function V2Sidebar({ roles, displayName, username }: V2SidebarProps) {
  const pathname = usePathname();
  const visibleGroups = getVisibleV2NavGroups(roles);
  const canManageStaff = rolesHaveCapability(roles, "staff");
  const roleText =
    roles.length > 0
      ? roles.map((role) => V2_ROLE_LABELS[role]).join(" / ")
      : "未分配角色";

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col overflow-hidden border-r border-stone-200 bg-white">
      <div className="shrink-0 border-b border-stone-200 px-5 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Flower Studio 2.0
        </p>
        <p className="mt-1 text-lg font-semibold tracking-tight text-stone-900">
          花店经营管理
        </p>
      </div>

      <nav aria-label="V2 导航" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        {visibleGroups.length === 0 ? (
          <p className="rounded-lg bg-stone-50 px-3 py-4 text-sm text-stone-500">
            当前账号没有可访问的 V2 菜单。如有疑问请联系门店管理员。
          </p>
        ) : (
          visibleGroups.map((group, groupIndex) => (
            <div
              key={group.title}
              className={
                groupIndex > 0 ? "mt-5 border-t border-stone-100 pt-4" : ""
              }
            >
              <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-stone-400">
                {group.title}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = isV2NavItemActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 ${
                          isActive
                            ? "bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-100"
                            : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                        }`}
                      >
                        <span aria-hidden className="w-5 shrink-0 text-center">
                          {item.icon}
                        </span>
                        <span className="min-w-0 truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>

      <div className="shrink-0 border-t border-stone-200 p-3">
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="truncate text-sm font-medium text-stone-900">
            {displayName ?? username}
          </p>
          <p className="truncate text-xs text-stone-500">@{username}</p>
          <p className="mt-1 text-xs text-stone-600">{roleText}</p>
          {canManageStaff ? (
            <Link
              href="/v2/staff"
              aria-current={pathname === "/v2/staff" ? "page" : undefined}
              className="mt-2 inline-flex rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
            >
              账号与权限
            </Link>
          ) : (
            <p className="mt-2 text-xs text-stone-500">
              账号与权限由管理员维护
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
