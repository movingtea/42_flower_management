"use client";

import { IcpFooter } from "@/components/shared/IcpFooter";
import { StaffTopbar } from "@/components/shared/StaffTopbar";

type StaffAppShellProps = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  variant?: "wms" | "cms" | "admin";
  topbarTitle?: string;
  showFooter?: boolean;
  mainClassName?: string;
  shellClassName?: string;
};

export function StaffAppShell({
  sidebar,
  children,
  variant = "wms",
  topbarTitle,
  showFooter = false,
  mainClassName = "p-4 md:p-8",
  shellClassName = "bg-zinc-50/80",
}: StaffAppShellProps) {
  return (
    <div className={`flex h-screen overflow-hidden ${shellClassName}`}>
      {sidebar}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <StaffTopbar variant={variant} title={topbarTitle} />
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className={mainClassName}>
            {children}
            {showFooter ? <IcpFooter /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
