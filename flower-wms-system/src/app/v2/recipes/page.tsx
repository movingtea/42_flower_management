import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Prisma } from "@/generated/prisma-v2/client";
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
import { RecipeDraftEditor } from "./RecipeDraftEditor";
import {
  publishRecipeVersionAction,
  retireRecipeVersionAction,
  saveRecipeDraftAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Search = {
  q?: string | string[];
  recipeId?: string | string[];
  message?: string | string[];
  error?: string | string[];
};

const recipeInclude = {
  sku: { include: { product: true } },
  versions: {
    include: { lines: { include: { material: true } } },
    orderBy: { versionNo: "desc" },
  },
} satisfies Prisma.RecipeInclude;

const skuInclude = {
  product: true,
  recipe: {
    include: {
      versions: {
        orderBy: { versionNo: "desc" },
        take: 1,
        include: { lines: true },
      },
    },
  },
} satisfies Prisma.ProductSkuInclude;

type RecipeRow = Prisma.RecipeGetPayload<{ include: typeof recipeInclude }>;
type RecipeVersionRow = RecipeRow["versions"][number];

const STATE_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  RETIRED: "已停用",
};

function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

function stateTone(state: string): "success" | "info" | "neutral" {
  if (state === "PUBLISHED") return "success";
  if (state === "DRAFT") return "info";
  return "neutral";
}

function dateTime(value: Date | null): string {
  return value ? value.toLocaleString("zh-CN") : "—";
}

function publishedVersion(recipe: RecipeRow): RecipeVersionRow | null {
  return recipe.versions.find((version) => version.state === "PUBLISHED") ?? null;
}

function linePayload(version: RecipeVersionRow | null | undefined) {
  return (
    version?.lines.map((line) => ({
      materialId: line.materialId,
      quantity: Number(line.plannedQty),
    })) ?? []
  );
}

function detailHref(recipeId: string, query: string): string {
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  search.set("recipeId", recipeId);
  return `/v2/recipes?${search.toString()}`;
}

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2/recipes");
  }
  const { tenantId } = await requireV2Store("catalog");

  const where: Prisma.RecipeWhereInput = {
    sku: { product: { tenantId } },
  };
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  if (query) {
    where.OR = [
      { sku: { code: { contains: query, mode: "insensitive" } } },
      { sku: { name: { contains: query, mode: "insensitive" } } },
      { sku: { product: { code: { contains: query, mode: "insensitive" } } } },
      { sku: { product: { name: { contains: query, mode: "insensitive" } } } },
    ];
  }

  const [recipes, skus, materials] = await Promise.all([
    v2db.recipe.findMany({
      where,
      include: recipeInclude,
      orderBy: { sku: { code: "asc" } },
    }),
    v2db.productSku.findMany({
      where: { product: { tenantId } },
      include: skuInclude,
      orderBy: { code: "asc" },
    }),
    v2db.material.findMany({
      where: { tenantId },
      orderBy: { code: "asc" },
    }),
  ]);

  const feedback = readV2Feedback(params);
  const explicitRecipeId =
    typeof params.recipeId === "string" ? params.recipeId.trim() : "";
  const selectedRecipe = explicitRecipeId
    ? (recipes.find((recipe) => recipe.id === explicitRecipeId) ?? null)
    : (recipes[0] ?? null);
  const invalidSelection = explicitRecipeId.length > 0 && !selectedRecipe;
  const currentPublished = selectedRecipe
    ? publishedVersion(selectedRecipe)
    : null;
  const draftCount = selectedRecipe
    ? selectedRecipe.versions.filter((version) => version.state === "DRAFT").length
    : 0;

  const materialOptions = materials.map((material) => ({
    id: material.id,
    label: `${material.code} · ${material.name} · ${material.baseUnit}${
      material.active ? "" : "（已停用）"
    }`,
    baseUnit: material.baseUnit,
    quantityScale: material.quantityScale,
  }));
  const skuOptions = skus.map((sku) => {
    const latest = sku.recipe?.versions[0] ?? null;
    return {
      id: sku.id,
      label: `${sku.product.code} · ${sku.product.name} / ${sku.code} · ${
        sku.name
      }${
        latest
          ? `（已有配方 v${latest.versionNo} ${stateLabel(latest.state)}）`
          : "（未建立配方）"
      }`,
      lines:
        latest?.lines.map((line) => ({
          materialId: line.materialId,
          quantity: Number(line.plannedQty),
        })) ?? [],
    };
  });
  const missingRecipeSkuCount = skus.filter((sku) => !sku.recipe).length;
  const selectedPrefill = linePayload(currentPublished ?? selectedRecipe?.versions[0]);

  const createEditor = (
    <RecipeDraftEditor
      key="recipe-create"
      action={saveRecipeDraftAction}
      materials={materialOptions}
      skus={skuOptions}
      initialLines={[]}
      submitLabel="创建配方草稿"
    />
  );

  return (
    <V2ModulePage
      title="标准配方"
      description="按 SKU 管理配方版本；已发布版本不可覆盖，修改会生成新草稿版本。"
      message={feedback.message}
      error={feedback.error}
      actions={
        <>
          <Link
            href="/v2/catalog"
            className="text-sm font-medium text-emerald-700"
          >
            商品与 SKU
          </Link>
          <Link
            href="/v2/packaging-kits"
            className="text-sm font-medium text-emerald-700"
          >
            包装方案
          </Link>
        </>
      }
    >
      <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className={`${card} space-y-4 lg:sticky lg:top-6`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-zinc-900">配方列表</h2>
            <span className="text-xs text-zinc-500">
              {recipes.length} 个配方
            </span>
          </div>

          <form className="flex gap-2">
            <input
              className={input}
              name="q"
              defaultValue={query}
              placeholder="搜索商品或 SKU 编码 / 名称"
            />
            <button className={button}>查询</button>
          </form>
          {query && (
            <Link
              href="/v2/recipes"
              className="text-xs text-zinc-500 underline"
            >
              清除搜索
            </Link>
          )}

          <details className="relative">
            <summary className={`${button} w-full cursor-pointer list-none text-center`}>
              新建配方草稿
            </summary>
            <div className="absolute left-0 z-30 mt-2 w-[min(44rem,90vw)] rounded-xl border border-zinc-200 bg-white p-5 shadow-xl">
              <h3 className="mb-3 font-semibold">新建标准配方草稿</h3>
              {createEditor}
            </div>
          </details>
          <p className="text-xs text-zinc-500">
            共 {skus.length} 个 SKU，其中 {missingRecipeSkuCount} 个尚未建立配方；可在上方直接为任意 SKU 创建第一版草稿。
          </p>

          {recipes.length === 0 ? (
            <ActionEmptyState
              title={query ? "没有匹配的配方" : "还没有标准配方"}
              description={
                query
                  ? "请调整搜索条件，或清除搜索查看全部配方。"
                  : "为商品 SKU 创建第一版配方草稿，发布后即可供生产与成本核算使用。"
              }
            />
          ) : (
            <ul className="space-y-2">
              {recipes.map((recipe) => {
                const published = publishedVersion(recipe);
                const isActive = selectedRecipe?.id === recipe.id;
                return (
                  <li key={recipe.id}>
                    <Link
                      href={detailHref(recipe.id, query)}
                      className={`block rounded-xl border p-3 transition-colors ${
                        isActive
                          ? "border-emerald-300 bg-emerald-50/60"
                          : "border-zinc-200 bg-white hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-900">
                            {recipe.sku.product.name}
                          </p>
                          <p className="truncate text-xs text-zinc-500">
                            {recipe.sku.product.code} · {recipe.sku.code} ·{" "}
                            {recipe.sku.name}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-zinc-500">
                          {recipe.versions.length} 版
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {published ? (
                          <>
                            <StatusBadge tone="success">
                              当前 v{published.versionNo}
                            </StatusBadge>
                            <span className="text-zinc-500">
                              {published.lines.length} 项物料 · 发布于{" "}
                              {dateTime(published.publishedAt)}
                            </span>
                          </>
                        ) : (
                          <StatusBadge tone="neutral">暂无已发布版本</StatusBadge>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="space-y-5">
          {invalidSelection ? (
            <div className={`${card} border-amber-300 bg-amber-50`}>
              <h2 className="text-lg font-semibold text-amber-950">
                所选配方不存在
              </h2>
              <p className="mt-2 text-sm text-amber-900">
                该配方不存在或不属于当前租户，请从左侧列表重新选择。
              </p>
            </div>
          ) : !selectedRecipe ? (
            <div className={card}>
              <h2 className="text-lg font-semibold text-zinc-900">
                新建标准配方草稿
              </h2>
              <p className="mt-1 mb-4 text-sm text-zinc-500">
                当前还没有可展示的配方。选择任意租户 SKU，填写物料与用量后保存。
              </p>
              {skus.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  当前租户还没有 SKU，请先前往{" "}
                  <Link href="/v2/catalog" className="underline">
                    商品与 SKU
                  </Link>{" "}
                  创建商品和 SKU。
                </div>
              ) : (
                createEditor
              )}
            </div>
          ) : (
            <>
              <div className={card}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-zinc-900">
                      {selectedRecipe.sku.product.name}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      商品编码 {selectedRecipe.sku.product.code} · SKU{" "}
                      {selectedRecipe.sku.code} · {selectedRecipe.sku.name}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <Link
                      href="/v2/catalog"
                      className="text-emerald-700 underline"
                    >
                      前往商品与 SKU
                    </Link>
                    <Link
                      href="/v2/packaging-kits"
                      className="text-emerald-700 underline"
                    >
                      包装方案
                    </Link>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 rounded-lg bg-stone-50 p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-xs text-zinc-500">当前发布版本</p>
                    <p className="mt-1 font-medium">
                      {currentPublished
                        ? `第 ${currentPublished.versionNo} 版`
                        : "暂无已发布版本"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">发布时间</p>
                    <p className="mt-1 font-medium">
                      {dateTime(currentPublished?.publishedAt ?? null)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">生效时间</p>
                    <p className="mt-1 font-medium">
                      {dateTime(currentPublished?.effectiveAt ?? null)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">版本 / 草稿</p>
                    <p className="mt-1 font-medium">
                      {selectedRecipe.versions.length} 个版本 · {draftCount} 个草稿
                    </p>
                  </div>
                </div>

                <details className="mt-4 rounded-lg border border-zinc-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-emerald-700">
                    新建草稿版本
                  </summary>
                  <div className="mt-3">
                    <RecipeDraftEditor
                      key={`new-${selectedRecipe.id}`}
                      action={saveRecipeDraftAction}
                      materials={materialOptions}
                      skuId={selectedRecipe.sku.id}
                      initialLines={selectedPrefill}
                      submitLabel="创建新草稿"
                    />
                  </div>
                </details>
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold text-zinc-900">
                    版本历史
                  </h3>
                  <p className="text-xs text-zinc-500">
                    已发布与已停用版本只读；停用已发布版本后该 SKU 将没有当前发布配方。
                  </p>
                </div>

                {selectedRecipe.versions.length === 0 ? (
                  <ActionEmptyState
                    title="还没有配方版本"
                    description="在右上方创建第一版配方草稿，填写物料后保存。"
                  />
                ) : (
                  selectedRecipe.versions.map((version) => (
                    <article
                      key={version.id}
                      className={`${card} border-zinc-200`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-base font-semibold text-zinc-900">
                            第 {version.versionNo} 版
                          </h4>
                          <StatusBadge tone={stateTone(version.state)}>
                            {stateLabel(version.state)}
                          </StatusBadge>
                          <span className="text-xs text-zinc-500">
                            {version.lines.length} 项物料
                          </span>
                        </div>
                        <div className="text-right text-xs text-zinc-500">
                          <p>发布：{dateTime(version.publishedAt)}</p>
                          <p>生效：{dateTime(version.effectiveAt)}</p>
                        </div>
                      </div>

                      <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200">
                        <table className="w-full text-left text-sm">
                          <thead className={tableHead}>
                            <tr>
                              <th className="px-3 py-2">物料编码</th>
                              <th>物料名称</th>
                              <th>用量</th>
                              <th>单位</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {version.lines.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={4}
                                  className="px-3 py-3 text-zinc-500"
                                >
                                  此版本没有物料明细。
                                </td>
                              </tr>
                            ) : (
                              version.lines.map((line) => (
                                <tr key={line.id}>
                                  <td className="px-3 py-2 font-mono text-xs text-zinc-700">
                                    {line.material.code}
                                  </td>
                                  <td>{line.material.name}</td>
                                  <td>{Number(line.plannedQty)}</td>
                                  <td>{line.material.baseUnit}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      {version.state === "DRAFT" && (
                        <div className="mt-4 flex flex-wrap items-start gap-3">
                          <details className="min-w-0 flex-1">
                            <summary className="cursor-pointer text-sm font-medium text-emerald-700">
                              编辑草稿
                            </summary>
                            <div className="mt-3 rounded-lg border border-zinc-200 bg-stone-50 p-3">
                              <RecipeDraftEditor
                                key={`draft-${version.id}`}
                                action={saveRecipeDraftAction}
                                materials={materialOptions}
                                skuId={selectedRecipe.sku.id}
                                versionId={version.id}
                                initialLines={linePayload(version)}
                                submitLabel="保存草稿"
                              />
                            </div>
                          </details>
                          <form action={publishRecipeVersionAction}>
                            <input
                              type="hidden"
                              name="versionId"
                              value={version.id}
                            />
                            <button className={button}>发布此版本</button>
                          </form>
                        </div>
                      )}

                      {version.state === "PUBLISHED" && (
                        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3">
                          <form action={retireRecipeVersionAction}>
                            <input
                              type="hidden"
                              name="versionId"
                              value={version.id}
                            />
                            <button className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">
                              停用此发布版本
                            </button>
                          </form>
                          <p className="text-xs text-zinc-500">
                            已发布版本不可编辑；如需调整，请新建草稿并发布。
                          </p>
                        </div>
                      )}

                      {version.state === "RETIRED" && (
                        <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                          已停用版本仅保留历史记录，不可编辑或再次发布。
                        </p>
                      )}
                    </article>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </V2ModulePage>
  );
}
