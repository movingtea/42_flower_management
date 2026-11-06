import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Context, type V2AccessContext } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  V2_CAPABILITY_DENIED_MESSAGE,
  V2_ROLE_LABELS,
  V2_ROLES,
  type V2Role,
} from "@/v2/navigation";
import {
  listStaffForManagement,
  type StaffManagementRow,
} from "@/v2/services/staff-management";
import { V2ModulePage, button, card, input } from "../_components/V2Ui";
import { readV2Feedback } from "../_lib/search-params";
import {
  createStaffAccountAction,
  resetStaffPasswordAction,
  setStaffActiveAction,
  updateStaffRolesAction,
} from "./actions";

export const dynamic = "force-dynamic";

type StaffPageSearchParams = Promise<{
  message?: string | string[];
  error?: string | string[];
}>;

const ROLE_OPTIONS = V2_ROLES.map((role) => ({
  value: role,
  label: V2_ROLE_LABELS[role],
}));

function roleSummary(roles: readonly V2Role[]): string {
  return roles.length > 0
    ? roles.map((role) => V2_ROLE_LABELS[role]).join("、")
    : "未分配角色";
}

function StaffRow({ row }: { row: StaffManagementRow }) {
  const displayName = row.displayName ?? row.username;
  const canDeactivate = !row.isSelf && row.active;
  const canActivate = !row.active;

  return (
    <li className="space-y-4 border-t border-stone-200 px-5 py-5 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-stone-900">
            {displayName}
            {row.isSelf ? (
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                当前账号
              </span>
            ) : null}
          </p>
          <p className="text-sm text-stone-500">@{row.username}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            row.active
              ? "bg-emerald-100 text-emerald-800"
              : "bg-stone-100 text-stone-600"
          }`}
        >
          {row.active ? "已启用" : "已停用"}
        </span>
      </div>

      <div className="grid gap-2 text-sm text-stone-600 md:grid-cols-2">
        <p>
          <span className="font-medium text-stone-700">租户角色：</span>
          {roleSummary(row.tenantMembership.roles)}
          {row.tenantMembership.active ? "" : "（租户成员已停用）"}
        </p>
        <p>
          <span className="font-medium text-stone-700">门店角色：</span>
          {roleSummary(row.storeMembership.roles)}
          {row.storeMembership.active ? "" : "（门店成员已停用）"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form
          action={updateStaffRolesAction}
          className="rounded-xl border border-stone-200 bg-stone-50/60 p-4"
        >
          <input type="hidden" name="targetStaffId" value={row.id} />
          <p className="text-sm font-medium text-stone-800">分配 WMS 角色</p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {ROLE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 text-sm text-stone-700"
              >
                <input
                  type="checkbox"
                  name="roles"
                  value={option.value}
                  defaultChecked={row.storeMembership.roles.includes(
                    option.value
                  )}
                />
                {option.label}
              </label>
            ))}
          </div>
          <button className={`${button} mt-3`} type="submit">
            保存角色
          </button>
        </form>

        <div className="space-y-4">
          <form
            action={resetStaffPasswordAction}
            className="rounded-xl border border-stone-200 bg-stone-50/60 p-4"
          >
            <input type="hidden" name="targetStaffId" value={row.id} />
            <label className="block text-sm text-stone-700">
              重置登录密码
              <input
                className={`${input} mt-1`}
                name="password"
                type="password"
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                required
              />
            </label>
            <p className="mt-1 text-xs text-stone-500">
              至少 8 位、UTF-8 最多 72 字节，首尾不能有空格。
            </p>
            <button className={`${button} mt-3`} type="submit">
              重置密码
            </button>
          </form>

          <form
            action={setStaffActiveAction}
            className="rounded-xl border border-stone-200 bg-stone-50/60 p-4"
          >
            <input type="hidden" name="targetStaffId" value={row.id} />
            <input
              type="hidden"
              name="active"
              value={row.active ? "false" : "true"}
            />
            <p className="text-sm text-stone-700">
              {row.active
                ? "停用后该账号将无法登录，且租户/门店成员同时停用。"
                : "启用后恢复该账号的租户/门店成员身份。"}
            </p>
            <button
              className={`mt-3 rounded-lg px-4 py-2 text-sm font-medium text-white ${
                row.active
                  ? "bg-rose-700 hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                  : "bg-emerald-700 hover:bg-emerald-800"
              }`}
              type="submit"
              disabled={!canActivate && !canDeactivate}
            >
              {row.active ? "停用账号" : "启用账号"}
            </button>
            {row.isSelf && row.active ? (
              <p className="mt-1 text-xs text-stone-500">
                不能停用当前登录账号。
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </li>
  );
}

export default async function V2StaffPage({
  searchParams,
}: {
  searchParams: StaffPageSearchParams;
}) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/staff");
  }

  let access: V2AccessContext;
  try {
    access = await requireV2Context("staff");
  } catch (cause) {
    if (
      !(cause instanceof Error) ||
      cause.message !== V2_CAPABILITY_DENIED_MESSAGE
    ) {
      throw cause;
    }
    return (
      <V2ModulePage
        title="员工与权限"
        error="当前账号没有员工管理权限"
      >
        <p className="text-sm text-stone-600">
          员工账号管理仅限当前门店的启用管理员。如需调整权限，请联系门店管理员。
        </p>
        <Link href="/v2" className={button}>
          返回经营概览
        </Link>
      </V2ModulePage>
    );
  }

  const [params, rows] = await Promise.all([
    searchParams,
    listStaffForManagement(v2db, {
      tenantId: access.tenantId,
      storeId: access.storeId,
      actorStaffId: access.staffId,
    }),
  ]);
  const feedback = readV2Feedback(params);

  return (
    <V2ModulePage
      title="员工与权限"
      message={feedback.message}
      error={feedback.error}
    >
      <p className="max-w-3xl text-sm leading-6 text-stone-600">
        仅当前门店的启用管理员可以管理员工账号。账号、角色和启停状态只作用于当前租户/门店；每次操作都会写入审计日志。
      </p>

      <section className={card}>
        <h2 className="text-xl font-semibold">新建员工账号</h2>
        <form
          action={createStaffAccountAction}
          className="mt-4 grid gap-4 lg:grid-cols-2"
        >
          <label className="block text-sm text-stone-700">
            用户名
            <input
              className={`${input} mt-1`}
              name="username"
              type="text"
              minLength={3}
              maxLength={32}
              autoComplete="off"
              required
            />
            <span className="mt-1 block text-xs text-stone-500">
              3-32 位字母、数字、点、下划线或短横线，保存时统一转为小写。
            </span>
          </label>
          <label className="block text-sm text-stone-700">
            显示名
            <input
              className={`${input} mt-1`}
              name="displayName"
              type="text"
              maxLength={50}
              required
            />
          </label>
          <label className="block text-sm text-stone-700">
            初始密码
            <input
              className={`${input} mt-1`}
              name="password"
              type="password"
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              required
            />
            <span className="mt-1 block text-xs text-stone-500">
              至少 8 位、UTF-8 最多 72 字节，首尾不能有空格；密码不会回显或写入审计日志。
            </span>
          </label>
          <fieldset className="text-sm text-stone-700">
            <legend className="mb-1 font-medium">WMS 角色（至少一个）</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {ROLE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="roles"
                    value={option.value}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="lg:col-span-2">
            <button className={button} type="submit">
              创建员工账号
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-5 py-4">
          <h2 className="text-xl font-semibold">当前门店员工</h2>
          <p className="text-sm text-stone-500">共 {rows.length} 人</p>
        </div>
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-stone-500">当前门店暂无员工账号。</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <StaffRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>
    </V2ModulePage>
  );
}
