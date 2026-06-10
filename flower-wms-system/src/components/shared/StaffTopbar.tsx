"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ROLE_LABEL } from "@/lib/role-labels";
import { getAllWmsNavItems, isNavItemActive } from "@/lib/wms-nav";

type StaffTopbarProps = {
  variant?: "wms" | "cms" | "admin";
  title?: string;
  /** 门户浮动条等场景：不显示左侧模块标题 */
  hideModuleTitle?: boolean;
};

const CMS_MODULE_TITLE = "CMS 运营内容";
const ADMIN_MODULE_TITLE = "系统管理";

function resolveWmsTitle(pathname: string): string {
  const matched = getAllWmsNavItems().find((item) =>
    isNavItemActive(pathname, item)
  );
  if (matched) return matched.label;
  if (pathname.startsWith("/wms/crm")) return "客户 CRM";
  return "WMS 工作台";
}

function resolveTitle(
  variant: StaffTopbarProps["variant"],
  pathname: string,
  title?: string
): string {
  if (title) return title;
  if (variant === "cms") return CMS_MODULE_TITLE;
  if (variant === "admin") return ADMIN_MODULE_TITLE;
  return resolveWmsTitle(pathname);
}

export function StaffTopbar({
  variant = "wms",
  title,
  hideModuleTitle = false,
}: StaffTopbarProps) {
  const pathname = usePathname();
  const { data } = useSession();
  const user = data?.user;

  const displayTitle = resolveTitle(variant, pathname, title);
  const username = user?.username ?? user?.email ?? "当前账号";
  const roleCode = user?.role ?? "";
  const roleLabel = roleCode
    ? ROLE_LABEL[roleCode as keyof typeof ROLE_LABEL] ?? roleCode
    : "";

  const borderClass =
    variant === "cms" ? "border-rose-100" : "border-zinc-200";

  async function handleSignOut() {
    await signOut({ redirect: true, callbackUrl: "/login" });
  }

  return (
    <header
      className={`flex h-14 shrink-0 items-center ${hideModuleTitle ? "justify-end" : "justify-between"} gap-4 border-b ${borderClass} bg-white px-4 md:px-6`}
    >
      {!hideModuleTitle ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {displayTitle}
          </p>
        </div>
      ) : null}

      {user ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 md:gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-zinc-900">{username}</p>
            {roleLabel ? (
              <p className="text-xs text-zinc-500">{roleLabel}</p>
            ) : null}
          </div>
          {roleCode ? (
            <Badge variant="default">
              <span className="font-mono text-[10px]">{roleCode}</span>
            </Badge>
          ) : null}
          {variant !== "admin" ? (
            <Link
              href="/"
              className="rounded-lg px-2 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
            >
              返回工作台
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-800"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">退出登录</span>
          </button>
        </div>
      ) : null}
    </header>
  );
}
