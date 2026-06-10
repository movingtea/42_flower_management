import { StaffAppShell } from "@/components/shared/StaffAppShell";
import { WmsForbiddenNotice } from "@/components/wms/WmsForbiddenNotice";
import { WmsSidebar } from "@/components/wms/sidebar";
import { auth } from "@/auth";
import { Role } from "@/generated/prisma/enums";
import { getVisibleNavGroups } from "@/lib/wms-nav";

export const metadata = {
  title: "WMS · 仓储物流与履约",
  description: "花店仓库管理、入库、库存、损耗与订单履约",
};

export default async function WmsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const hasWmsMenu = role ? getVisibleNavGroups(role).length > 0 : false;

  return (
    <StaffAppShell
      variant="wms"
      sidebar={<WmsSidebar />}
      showFooter
    >
      {hasWmsMenu ? children : <WmsForbiddenNotice role={role} />}
    </StaffAppShell>
  );
}
