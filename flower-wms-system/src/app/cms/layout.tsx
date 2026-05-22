import { CmsSidebar } from "@/components/cms/sidebar";

export const metadata = {
  title: "CMS · 小程序运营内容",
  description: "商城商品、首页轮播与营销配置",
};

export default function CmsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-rose-50/30">
      <CmsSidebar />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
