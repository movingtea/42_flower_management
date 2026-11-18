import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  ActionEmptyState,
  Field,
  StatusBadge,
  V2ModulePage,
  button,
  input,
  tableHead,
  tableShell,
} from "../_components/V2Ui";
import { readV2Feedback } from "../_lib/search-params";
import {
  createMaterialCategoryAction,
  deleteMaterialCategoryAction,
  setMaterialCategoryActiveAction,
  updateMaterialCategoryAction,
} from "./actions";

export const dynamic = "force-dynamic";

type CategoryFieldsValue = {
  name: string;
  description: string | null;
  sortOrder: number;
};

function CategoryFields({ value, create = false }: { value?: CategoryFieldsValue; create?: boolean }) {
  return <div className="space-y-3">
    <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
      <Field label="分类名称" name="name" required defaultValue={value?.name} />
      <Field label="排序值（越小越靠前）" name="sortOrder" type="number" required={false} defaultValue={value?.sortOrder ?? 0} />
    </div>
    <label className="block text-sm text-stone-700">分类说明<textarea className={`${input} mt-1 min-h-20`} name="description" maxLength={500} defaultValue={value?.description ?? ""} placeholder="可选，最多 500 字" /></label>
    {create && <label className="flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" name="active" defaultChecked /> 创建后立即启用</label>}
  </div>;
}

export default async function MaterialCategoriesPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; message?: string | string[]; error?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") redirect("/login?callbackUrl=/v2/material-categories");
  const { tenantId } = await requireV2Store("catalog");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const categories = await v2db.materialCategory.findMany({
    where: {
      tenantId,
      ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
    },
    include: { _count: { select: { materials: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const feedback = readV2Feedback(params);

  return <V2ModulePage
    title="原材料分类"
    description="维护物料的业务分类、展示顺序和启停状态；分类编码由系统自动生成，无需手工填写。"
    message={feedback.message}
    error={feedback.error}
    actions={<details className="relative">
      <summary className={`${button} cursor-pointer list-none`}>新增分类</summary>
      <div className="absolute right-0 z-20 mt-2 w-[min(32rem,90vw)] rounded-xl border border-zinc-200 bg-white p-5 shadow-xl">
        <form action={createMaterialCategoryAction} className="space-y-4">
          <h3 className="font-semibold">新增原材料分类</h3>
          <CategoryFields create />
          <button className={button}>保存分类</button>
        </form>
      </div>
    </details>}
  >
    <form className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-white p-4">
      <input className={`${input} max-w-sm`} name="q" defaultValue={query} placeholder="搜索分类名称" />
      <button className={button}>查询</button>
    </form>

    {categories.length === 0
      ? <ActionEmptyState
        title={query ? "没有匹配的原材料分类" : "还没有原材料分类"}
        description={query ? "换个名称关键词再试，或清空搜索查看全部分类。" : "先创建分类，再到物料母表把物料关联到对应分类。"}
      />
      : <div className={tableShell}>
        <table className="w-full text-left text-sm">
          <thead className={tableHead}>
            <tr>
              <th className="px-4 py-3">分类</th>
              <th>说明</th>
              <th>排序</th>
              <th>关联物料</th>
              <th>状态</th>
              <th className="px-4">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {categories.map((category) => <tr key={category.id} className={category.active ? "align-top hover:bg-zinc-50" : "align-top bg-zinc-50 text-zinc-500"}>
              <td className="px-4 py-3">
                <div className="font-medium text-zinc-900">{category.name}</div>
                <div className="text-xs text-zinc-500">{category.code}</div>
              </td>
              <td className="max-w-xs py-3 text-xs text-zinc-600">{category.description || "—"}</td>
              <td>{category.sortOrder}</td>
              <td>{category._count.materials}</td>
              <td><StatusBadge tone={category.active ? "success" : "neutral"}>{category.active ? "启用" : "停用"}</StatusBadge></td>
              <td className="px-4 py-3">
                <details>
                  <summary className="cursor-pointer text-emerald-700">编辑</summary>
                  <form action={updateMaterialCategoryAction} className="mt-3 w-[min(32rem,75vw)] space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg">
                    <input type="hidden" name="categoryId" value={category.id} />
                    <CategoryFields value={category} />
                    <button className={button}>保存修改</button>
                  </form>
                </details>
                <form action={setMaterialCategoryActiveAction} className="mt-2">
                  <input type="hidden" name="categoryId" value={category.id} />
                  <input type="hidden" name="active" value={String(!category.active)} />
                  <button className="text-xs text-zinc-600 underline">{category.active ? "停用" : "重新启用"}</button>
                </form>
                <form action={deleteMaterialCategoryAction} className="mt-1">
                  <input type="hidden" name="categoryId" value={category.id} />
                  <button
                    className="text-xs text-red-700 underline disabled:cursor-not-allowed disabled:text-zinc-400 disabled:no-underline"
                    disabled={category._count.materials > 0}
                    title={category._count.materials > 0 ? "该分类仍有关联物料，需先调整物料分类" : "删除分类"}
                  >删除</button>
                </form>
                {category._count.materials > 0 && <p className="mt-1 max-w-[12rem] text-xs text-zinc-400">有关联物料，不能删除</p>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>}

    <p className="text-xs text-zinc-400">共 {categories.length} 个分类；排序值相同时按名称排列。删除分类前需先解除它与全部物料的关联。</p>
  </V2ModulePage>;
}
