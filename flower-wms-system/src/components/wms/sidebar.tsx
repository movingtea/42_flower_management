"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Role } from "@/generated/prisma/enums";
import {
  getVisibleNavGroups,
  isNavItemActive,
} from "@/lib/wms-nav";

export function WmsSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;

  const visibleGroups = role ? getVisibleNavGroups(role) : [];

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-white">
      <div className="shrink-0 border-b border-zinc-200 px-5 py-6">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          WMS
        </p>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900">
          仓储物流与履约
        </h1>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        {visibleGroups.length === 0 ? (
          <p className="rounded-lg bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
            当前账号没有可访问的 WMS 菜单。如有疑问请联系门店管理员。
          </p>
        ) : (
          visibleGroups.map((group, groupIndex) => (
            <div
              key={group.title}
              className={groupIndex > 0 ? "mt-5 border-t border-zinc-100 pt-4" : ""}
            >
              <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                {group.title}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = isNavItemActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-zinc-100 text-zinc-900"
                            : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                        }`}
                      >
                        <span aria-hidden className="shrink-0">
                          {item.icon}
                        </span>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}
