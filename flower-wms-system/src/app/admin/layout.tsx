import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { StaffAppShell } from "@/components/shared/StaffAppShell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StaffAppShell
      variant="admin"
      sidebar={<AdminSidebar />}
      mainClassName="p-6 md:p-8"
    >
      {children}
    </StaffAppShell>
  );
}
