import Link from "next/link";
import { Role } from "@/generated/prisma/enums";
import { getRoleHomePath } from "@/lib/auth-routes";
import { ROLE_LABEL } from "@/lib/role-labels";

type Props = {
  role?: Role;
};

export function WmsForbiddenNotice({ role }: Props) {
  const home = role ? getRoleHomePath(role) : "/login";
  const roleLabel = role ? ROLE_LABEL[role] ?? role : "未登录";

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-zinc-200 bg-white p-10 text-center shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">无权访问 WMS</h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600">
        当前账号（{roleLabel}）没有 WMS 业务菜单权限。请使用有权限的账号登录，或返回您的工作台。
      </p>
      <Link
        href={home}
        className="mt-6 inline-flex rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
      >
        返回工作台
      </Link>
    </div>
  );
}
