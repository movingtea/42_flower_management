"use client";

import { StaffTopbar } from "@/components/shared/StaffTopbar";

/** 工作台门户右上角账号与登出（门店主理人） */
export function PortalAccountStrip() {
  return (
    <div className="fixed right-4 top-4 z-40 w-auto min-w-[280px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200/80 bg-white/95 shadow-md backdrop-blur-sm">
      <StaffTopbar variant="wms" hideModuleTitle />
    </div>
  );
}
