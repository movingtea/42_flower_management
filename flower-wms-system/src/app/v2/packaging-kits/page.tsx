import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  ActionEmptyState,
  StatusBadge,
  V2ModulePage,
  button,
  card,
  input,
  tableHead,
} from "../_components/V2Ui";
import { readV2Feedback } from "../_lib/search-params";
import { V2DrawerForm } from "../_components/V2Drawer";
import { PackagingKitEditor } from "./PackagingKitEditor";
import {
  savePackagingKitAction,
  setPackagingKitActiveAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Search = {
  q?: string | string[];
  message?: string | string[];
  error?: string | string[];
};

type PackagingKitLineRow = {
  id: string;
  quantity: unknown;
  material: { code: string; name: string; baseUnit: string };
};

function dateTime(value: Date): string {
  return value.toLocaleString("zh-CN");
}

export default async function PackagingKitsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/packaging-kits");
  }
  const { tenantId } = await requireV2Store("catalog");

  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const feedback = readV2Feedback(params);

  const [kits, materials] = await Promise.all([
    v2db.packagingKit.findMany({
      where: {
        tenantId,
        ...(query
          ? {
              OR: [
                { code: { contains: query, mode: "insensitive" as const } },
                { name: { contains: query, mode: "insensitive" as const } },
                {
                  lines: {
                    some: {
                      material: {
                        OR: [
                          {
                            code: {
                              contains: query,
                              mode: "insensitive" as const,
                            },
                          },
                          {
                            name: {
                              contains: query,
                              mode: "insensitive" as const,
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        lines: { include: { material: true } },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    v2db.material.findMany({
      where: {
        tenantId,
        active: true,
        kind: { in: ["PACKAGING", "CONSUMABLE", "OTHER"] },
      },
      orderBy: { code: "asc" },
    }),
  ]);

  const materialOptions = materials.map((material) => ({
    id: material.id,
    label: `${material.code} · ${material.name} · ${material.baseUnit}`,
  }));
  const totalLines = kits.reduce((sum, kit) => sum + kit.lines.length, 0);

  return (
    <V2ModulePage
      title="包装方案管理"
      description="独立维护可复用的包装物料组合；包装方案与标准配方分开管理，不会被写入配方版本。"
      message={feedback.message}
      error={feedback.error}
      actions={
        <>
          <Link
            href="/v2/recipes"
            className="text-sm font-medium text-emerald-700"
          >
            标准配方
          </Link>
          <V2DrawerForm
            triggerLabel="新建包装方案"
            title="新建包装方案"
            description="方案编码由系统自动生成，创建后不可修改。"
            action={savePackagingKitAction}
            submitLabel="保存包装方案"
            size="xl"
            triggerClassName={button}
          >
            <PackagingKitEditor materials={materialOptions} />
          </V2DrawerForm>
        </>
      }
    >
      <form className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4">
        <input
          className={`${input} max-w-sm`}
          name="q"
          defaultValue={query}
          placeholder="搜索方案编码、名称或物料"
        />
        <button className={button}>查询</button>
        {query && (
          <Link
            href="/v2/packaging-kits"
            className="self-center text-sm text-zinc-500 underline"
          >
            清除搜索
          </Link>
        )}
      </form>

      {kits.length === 0 ? (
        <ActionEmptyState
          title={query ? "没有匹配的包装方案" : "还没有包装方案"}
          description={
            query
              ? "请调整搜索条件，或清除搜索查看全部包装方案。"
              : "建立常用包装组合，供多个 SKU 复用；每个方案至少包含一项包装 / 耗材 / 其他类物料。"
          }
        />
      ) : (
        <section className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {kits.map((kit) => (
              <article key={kit.id} className={`${card} relative`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-zinc-900">
                      {kit.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      方案编码 <span className="font-mono">{kit.code}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {kit.lines.length} 项物料
                    </p>
                  </div>
                  <StatusBadge tone={kit.active ? "success" : "neutral"}>
                    {kit.active ? "已启用" : "已停用"}
                  </StatusBadge>
                </div>

                <p className="mt-3 text-sm text-stone-600">
                  {kit.notes || "未填写备注"}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  最近更新：{dateTime(kit.updatedAt)}
                </p>

                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-emerald-700">
                    展开物料明细
                  </summary>
                  <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200">
                    <table className="w-full text-left text-xs">
                      <thead className={tableHead}>
                        <tr>
                          <th className="px-3 py-2">物料编码</th>
                          <th>物料名称</th>
                          <th>用量</th>
                          <th>单位</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {(kit.lines as PackagingKitLineRow[]).map((line) => (
                          <tr key={line.id}>
                            <td className="px-3 py-2 font-mono text-zinc-700">
                              {line.material.code}
                            </td>
                            <td>{line.material.name}</td>
                            <td>{Number(line.quantity)}</td>
                            <td>{line.material.baseUnit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    状态：{kit.active ? "启用" : "停用"} · 更新于{" "}
                    {dateTime(kit.updatedAt)}（备注：{kit.notes || "无"}）
                  </p>
                </details>

                <div className="mt-4 flex flex-wrap items-start gap-3">
                  <V2DrawerForm
                    triggerLabel="编辑方案"
                    title={`编辑包装方案：${kit.name}`}
                    description={`方案编码 ${kit.code} 创建后不可修改。`}
                    action={savePackagingKitAction}
                    submitLabel="保存包装方案"
                    size="xl"
                    triggerClassName="text-sm text-emerald-700 hover:underline"
                  >
                    <PackagingKitEditor
                      materials={materialOptions}
                      initial={{
                        id: kit.id,
                        code: kit.code,
                        name: kit.name,
                        notes: kit.notes ?? "",
                        lines: kit.lines.map((line) => ({
                          materialId: line.materialId,
                          quantity: Number(line.quantity),
                        })),
                      }}
                    />
                  </V2DrawerForm>

                  <form action={setPackagingKitActiveAction}>
                    <input type="hidden" name="id" value={kit.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={String(!kit.active)}
                    />
                    <button
                      className={
                        kit.active
                          ? "rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700"
                          : "rounded-lg border border-emerald-700 px-3 py-2 text-sm text-emerald-800"
                      }
                    >
                      {kit.active ? "停用方案" : "启用方案"}
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>

          <p className="text-xs text-zinc-400">
            共 {kits.length} 个包装方案、{totalLines} 项包装物料。包装方案不会合并进配方接口，也不会扣减包装耗材库存。
          </p>
        </section>
      )}
    </V2ModulePage>
  );
}
