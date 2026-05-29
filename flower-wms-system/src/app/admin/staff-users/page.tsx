import { auth } from "@/auth";
import { Role } from "@/generated/prisma/enums";
import { canManageStaffUsers } from "@/lib/rbac";
import { StaffUserManager } from "./StaffUserManager";

export const dynamic = "force-dynamic";

export default async function StaffUsersPage() {
  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const canResetPassword = role ? canManageStaffUsers(role) : false;

  return (
    <div className="mx-auto max-w-3xl p-6 md:p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900">用户与权限</h1>
        <p className="mt-1 text-sm text-zinc-500">
          IT 运维与门店主理人可管理后台账号；IT 运维无法访问业务数据。
        </p>
      </header>
      <StaffUserManager canResetPassword={canResetPassword} />
    </div>
  );
}
