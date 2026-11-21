import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  ActionEmptyState,
  Field,
  StatusBadge,
  V2ModulePage,
  V2Table,
  button,
  dataTableBody,
  dataTableHead,
  input,
  stickyActionHead,
} from "../_components/V2Ui";
import { V2DrawerForm } from "../_components/V2Drawer";
import { readV2Feedback } from "../_lib/search-params";
import {
  createSupplierAction,
  setSupplierActiveAction,
  updateSupplierAction,
} from "./actions";

export const dynamic = "force-dynamic";

/** Sticky action cell matching the shared 14rem action field width. */
const STICKY_ACTION = "sticky right-0 z-10 w-56 border-l border-stone-200 px-4 py-3 align-middle";

type SupplierFieldsValue = {
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  wechat: string | null;
  notes: string | null;
  defaultLossRate: unknown;
  lossRateNote: string | null;
};

/**
 * Supplier form fields shared by the create and edit drawers.
 * The supplier code is system-generated: it is never an editable input, and
 * the edit drawer only echoes it as read-only text.
 */
function SupplierFields({ value }: { value?: SupplierFieldsValue }) {
  return (
    <>
      {value && (
        <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">
          供应商编号 <span className="font-mono">{value.code}</span>
          （系统生成，创建后不可修改）
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="供应商名称" name="name" defaultValue={value?.name} />
        <Field
          label="联系人"
          name="contactName"
          required={false}
          defaultValue={value?.contactName ?? ""}
        />
        <Field
          label="联系电话"
          name="phone"
          required={false}
          defaultValue={value?.phone ?? ""}
        />
        <Field
          label="微信"
          name="wechat"
          required={false}
          defaultValue={value?.wechat ?? ""}
        />
        <label className="text-sm text-zinc-700">
          采购渠道损耗率（0–0.99）
          <input
            className={`${input} mt-1`}
            name="defaultLossRate"
            type="number"
            min={0}
            max={0.99}
            step={0.0001}
            defaultValue={value?.defaultLossRate == null ? "" : String(value.defaultLossRate)}
          />
        </label>
        <Field
          label="损耗说明"
          name="lossRateNote"
          required={false}
          defaultValue={value?.lossRateNote ?? ""}
        />
        <label className="text-sm text-zinc-700 md:col-span-2">
          备注
          <textarea
            className={`${input} mt-1 min-h-20`}
            name="notes"
            defaultValue={value?.notes ?? ""}
          />
        </label>
      </div>
    </>
  );
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    state?: string | string[];
    message?: string | string[];
    error?: string | string[];
  }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/suppliers");
  }
  const { tenantId, storeId } = await requireV2Store("purchase");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const state = typeof params.state === "string" ? params.state : "active";
  const suppliers = await v2db.supplier.findMany({
    where: {
      tenantId,
      ...(state === "all" ? {} : { active: state !== "inactive" }),
      ...(query
        ? {
            OR: [
              { code: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
              { contactName: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      purchases: {
        where: { storeId },
        select: { id: true, state: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  const feedback = readV2Feedback(params);

  return (
    <V2ModulePage
      title="供应商管理"
      description="维护供应商联系方式、启停状态并保留历史采购引用。"
      message={feedback.message}
      error={feedback.error}
      actions={
        <V2DrawerForm
          triggerLabel="新增供应商"
          title="新增供应商"
          description="供应商编号由系统自动生成，无需填写。"
          action={createSupplierAction}
          submitLabel="保存供应商"
          size="lg"
          triggerClassName={button}
        >
          <SupplierFields />
        </V2DrawerForm>
      }
    >
      <form className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4">
        <input
          className={`${input} max-w-sm`}
          name="q"
          defaultValue={query}
          placeholder="搜索编码、名称或联系人"
        />
        <select className={`${input} w-36`} name="state" defaultValue={state}>
          <option value="active">启用</option>
          <option value="inactive">已停用</option>
          <option value="all">全部</option>
        </select>
        <button className={button}>查询</button>
      </form>

      {suppliers.length === 0 ? (
        <ActionEmptyState
          title="还没有符合条件的供应商"
          description="新增供应商后即可创建采购单并保留采购历史。"
        />
      ) : (
        <V2Table
          label="供应商列表"
          fields={["code", "name", "text", "text", "text", "status", "action"]}
          minWidthClass="min-w-[68rem]"
        >
          <caption className="sr-only">供应商列表</caption>
          <thead className={dataTableHead}>
            <tr>
              <th scope="col" className="px-4 py-3 whitespace-nowrap">编号</th>
              <th scope="col" className="px-4 py-3 whitespace-nowrap">名称</th>
              <th scope="col" className="px-4 py-3 whitespace-nowrap">联系人</th>
              <th scope="col" className="px-4 py-3 whitespace-nowrap">渠道损耗</th>
              <th scope="col" className="px-4 py-3 whitespace-nowrap">最近采购</th>
              <th scope="col" className="px-4 py-3 whitespace-nowrap">状态</th>
              <th scope="col" className={`${stickyActionHead} whitespace-nowrap`}>操作</th>
            </tr>
          </thead>
          <tbody className={dataTableBody}>
            {suppliers.map((item) => (
              <tr
                key={item.id}
                className={`align-middle ${item.active ? "hover:bg-stone-50/70" : "bg-stone-50 text-stone-500"}`}
              >
                <td className="px-4 py-3 align-middle whitespace-nowrap">
                  <span className="font-mono text-xs text-stone-600">{item.code}</span>
                </td>
                <td className="px-4 py-3 align-middle">
                  <Link
                    href={`/v2/suppliers/${item.id}`}
                    className="font-medium text-stone-900 hover:text-emerald-700 hover:underline"
                  >
                    {item.name}
                  </Link>
                  {item.notes && (
                    <div className="mt-1 max-w-xs truncate text-xs text-stone-400">
                      {item.notes}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-middle">
                  <div className="whitespace-nowrap">{item.contactName || "—"}</div>
                  <div className="text-xs text-stone-500">
                    {[item.phone, item.wechat].filter(Boolean).join(" · ") ||
                      "暂无联系方式"}
                  </div>
                </td>
                <td className="px-4 py-3 align-middle">
                  {item.defaultLossRate === null
                    ? "未设置"
                    : `${(Number(item.defaultLossRate) * 100).toFixed(2)}%`}
                  {item.lossRateNote && (
                    <div className="max-w-40 truncate text-xs text-stone-400">{item.lossRateNote}</div>
                  )}
                </td>
                <td className="px-4 py-3 align-middle">
                  {item.purchases.length ? (
                    <>
                      <span className="whitespace-nowrap">{item.purchases.length} 条最近记录</span>
                      <div className="text-xs text-stone-500">
                        最新：{item.purchases[0]?.state}
                      </div>
                    </>
                  ) : (
                    "暂无采购"
                  )}
                </td>
                <td className="px-4 py-3 align-middle">
                  <StatusBadge tone={item.active ? "success" : "neutral"}>
                    {item.active ? "启用" : "停用"}
                  </StatusBadge>
                </td>
                <td className={`${STICKY_ACTION} ${item.active ? "bg-white" : "bg-stone-50"}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      className="text-xs font-medium text-emerald-700 underline underline-offset-2"
                      href={`/v2/suppliers/${item.id}`}
                    >
                      查看详情
                    </Link>
                    <V2DrawerForm
                      triggerLabel="编辑"
                      title={`编辑供应商：${item.name}`}
                      description={`供应商编号 ${item.code} 由系统生成，创建后不可修改。`}
                      action={updateSupplierAction}
                      submitLabel="保存修改"
                      size="lg"
                      triggerClassName="text-xs font-medium text-emerald-700 underline underline-offset-2"
                    >
                      <input type="hidden" name="supplierId" value={item.id} />
                      <SupplierFields value={item} />
                    </V2DrawerForm>
                    <form action={setSupplierActiveAction}>
                      <input type="hidden" name="supplierId" value={item.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={String(!item.active)}
                      />
                      <button className="text-xs text-stone-600 underline underline-offset-2">
                        {item.active ? "停用" : "重新启用"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </V2Table>
      )}
    </V2ModulePage>
  );
}
