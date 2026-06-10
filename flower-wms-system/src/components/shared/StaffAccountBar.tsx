/**
 * @deprecated 账号操作已迁移至 StaffTopbar。仅保留供尚未迁移的调用方；新代码请使用 StaffTopbar。
 */
"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { ROLE_LABEL } from "@/lib/role-labels";

type StaffAccountBarProps = {
  variant?: "wms" | "cms" | "admin";
};

export function StaffAccountBar({ variant = "wms" }: StaffAccountBarProps) {
  const { data } = useSession();
  const user = data?.user;
  if (!user) return null;

  const username = user.username ?? user.email ?? "—";
  const roleCode = user.role ?? "";
  const roleLabel = ROLE_LABEL[roleCode as keyof typeof ROLE_LABEL] ?? roleCode;

  const borderClass =
    variant === "cms"
      ? "border-rose-100"
      : variant === "admin"
        ? "border-zinc-200"
        : "border-zinc-200";

  async function handleSignOut() {
    await signOut({ redirect: true, callbackUrl: "/login" });
  }

  return (
    <div className={`border-t ${borderClass} p-4`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
        当前账号
      </p>
      <p className="mt-1.5 text-sm font-medium text-zinc-900">
        {username}{" "}
        <span className="font-mono text-xs font-normal text-zinc-500">
          ({roleCode})
        </span>
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">{roleLabel}</p>

      <div className="mt-3 flex flex-col gap-2">
        {variant !== "admin" && (
          <Link
            href="/"
            className="text-xs text-zinc-500 hover:text-zinc-800"
          >
            ← 返回工作台
          </Link>
        )}
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-800"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden />
          退出登录
        </button>
      </div>
    </div>
  );
}
