"use client";

import { usePathname } from "next/navigation";
import { StaffTopbar } from "@/components/shared/StaffTopbar";
import { getAllV2NavItems, isV2NavItemActive } from "@/v2/navigation";

/**
 * V2 topbar: reuses the shared staff topbar (account, role badge, sign out,
 * workspace link) but resolves the module title from the canonical V2
 * navigation instead of the V1 WMS menu. This keeps the shell coherent without
 * changing the shared topbar used by CMS/admin.
 */
export function V2Topbar() {
  const pathname = usePathname();
  const activeItem = getAllV2NavItems().find((item) =>
    isV2NavItemActive(pathname, item),
  );

  return (
    <StaffTopbar
      variant="wms"
      title={activeItem?.label ?? "花店经营管理"}
    />
  );
}
