import { CmsSidebar } from "@/components/cms/sidebar";
import { StaffAppShell } from "@/components/shared/StaffAppShell";

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
    <StaffAppShell
      variant="cms"
      sidebar={<CmsSidebar />}
      showFooter
      mainClassName="p-8"
      shellClassName="bg-rose-50/30"
    >
      {children}
    </StaffAppShell>
  );
}
