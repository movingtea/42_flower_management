import { WmsSidebar } from "@/components/wms/sidebar";

export const metadata = {
  title: "WMS · 仓储物流与履约",
  description: "花店仓库管理、入库、库存、损耗与订单履约",
};

export default function WmsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-zinc-50/80">
      <WmsSidebar />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
