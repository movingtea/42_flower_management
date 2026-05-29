"use client";

import { StaffAccountBar } from "@/components/shared/StaffAccountBar";

/** 工作台门户右上角账号与登出（门店主理人） */
export function PortalAccountStrip() {
  return (
    <div className="fixed right-4 top-4 z-40 w-56 rounded-xl border border-zinc-200/80 bg-white/95 shadow-md backdrop-blur-sm">
      <StaffAccountBar variant="wms" />
    </div>
  );
}
