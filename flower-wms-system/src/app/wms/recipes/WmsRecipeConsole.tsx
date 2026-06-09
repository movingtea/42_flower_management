"use client";

import { useCallback, useEffect, useState } from "react";
import { FlowerMaterialSelect } from "@/components/ui/FlowerMaterialSelect";
import { QuantityStepper } from "@/components/shared/QuantityStepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PackagingKitRow } from "@/lib/packaging-kit";
import { formatPercent } from "@/lib/format-money";
import type { WikiListItem } from "@/lib/wiki-constants";

type RecipeListItem = {
  id: string;
  recipeCode: string;
  name: string;
  ingredientSummary: string;
  packagingKitName: string | null;
  packagingKitStandardCost: string | null;
  standardMaterialCost: string;
  standardPackagingCost: string;
  standardTotalCost: string;
  missingStandardCostCount: number;
  productCount: number;
  ingredientCount: number;
};

type RecipeCostPreview = {
  materialCost: string;
  packagingCost: string;
  totalCost: string;
  lossModelStandardMaterialCost?: string;
  lossModelExtraCost?: string;
  lossModelStandardTotalCost?: string;
  missingStandardCostCount: number;
  isComplete: boolean;
  lines: Array<{
    flowerWikiId: string;
    flowerName: string;
    quantityNeeded: number;
    standardUnitCost: string | null;
    lineCost: string;
    warning?: string;
  }>;
  lossModelLines?: Array<{
    flowerWikiId: string;
    flowerName: string;
    quantityNeeded: number;
    standardUnitCost: string | null;
    rawUnitCost: string | null;
    adjustedUnitCost: string | null;
    usableRate: string | null;
    lossRate: string | null;
    rawLineCost: string;
    adjustedLineCost: string;
    lossModelExtraCost: string;
    warning?: string;
  }>;
  warnings: string[];
};

type DraftRow = {
  key: string;
  flowerWikiId: string | null;
  chineseName: string;
  englishName: string;
  colorTags: string[];
  quantity: number;
  duplicateError?: string;
};

type EditorMode = "create" | "edit";

function emptyRow(): DraftRow {
  return {
    key: `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    flowerWikiId: null,
    chineseName: "",
    englishName: "",
    colorTags: [],
    quantity: 1,
  };
}

function fromIngredient(item: {
  id?: string;
  flowerWikiId: string;
  quantity: number;
  chineseName: string;
  englishName: string;
  colorTags: string[];
}): DraftRow {
  return {
    key: item.id ?? `row-${item.flowerWikiId}`,
    flowerWikiId: item.flowerWikiId,
    chineseName: item.chineseName,
    englishName: item.englishName,
    colorTags: item.colorTags ?? [],
    quantity: item.quantity,
  };
}

export function WmsRecipeConsole() {
  const [items, setItems] = useState<RecipeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<EditorMode>("create");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recipeCode, setRecipeCode] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [packagingKits, setPackagingKits] = useState<PackagingKitRow[]>([]);
  const [selectedPackagingKitId, setSelectedPackagingKitId] = useState("");
  const [costPreview, setCostPreview] = useState<RecipeCostPreview | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const [productCount, setProductCount] = useState(0);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }

  const applyDuplicateFlags = useCallback((draft: DraftRow[]) => {
    const counts = new Map<string, number>();
    for (const row of draft) {
      if (!row.flowerWikiId) continue;
      counts.set(row.flowerWikiId, (counts.get(row.flowerWikiId) ?? 0) + 1);
    }
    return draft.map((row) => ({
      ...row,
      duplicateError:
        row.flowerWikiId && (counts.get(row.flowerWikiId) ?? 0) > 1
          ? "该物料已在配方中，请直接修改数量"
          : undefined,
    }));
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/wms/recipes");
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { items?: RecipeListItem[] };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "加载配方列表失败");
      }
      setItems(json.data?.items ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "加载配方列表失败", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPackagingKits = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/wms/packaging-kits?activeOnly=1");
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { list?: PackagingKitRow[] };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "加载包装方案失败");
      }
      setPackagingKits(json.data?.list ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "加载包装方案失败", "error");
    }
  }, []);

  const loadRecipe = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/admin/wms/recipes/${id}`);
        const json = (await res.json()) as {
          success?: boolean;
          error?: string;
          data?: {
            recipe?: {
              id: string;
              recipeCode: string;
              name: string;
              packagingKitId: string | null;
              standardCost: RecipeCostPreview;
              productCount: number;
              ingredients: Array<{
                id: string;
                flowerWikiId: string;
                quantity: number;
                chineseName: string;
                englishName: string;
                colorTags: string[];
              }>;
            };
          };
        };
        if (!res.ok || !json.success || !json.data?.recipe) {
          throw new Error(json.error ?? "加载配方详情失败");
        }
        const recipe = json.data.recipe;
        setMode("edit");
        setSelectedId(recipe.id);
        setRecipeCode(recipe.recipeCode);
        setRecipeName(recipe.name);
        setSelectedPackagingKitId(recipe.packagingKitId ?? "");
        setCostPreview(recipe.standardCost);
        setProductCount(recipe.productCount);
        setRows(
          recipe.ingredients.length > 0
            ? applyDuplicateFlags(recipe.ingredients.map(fromIngredient))
            : [emptyRow()]
        );
      } catch (e) {
        showToast(e instanceof Error ? e.message : "加载配方详情失败", "error");
      }
    },
    [applyDuplicateFlags]
  );

  useEffect(() => {
    void loadList();
    void loadPackagingKits();
  }, [loadList, loadPackagingKits]);

  function startCreate() {
    setMode("create");
    setSelectedId(null);
    setRecipeCode("");
    setRecipeName("");
    setSelectedPackagingKitId("");
    setCostPreview(null);
    setProductCount(0);
    setRows([emptyRow()]);
  }

  function updateRows(updater: (prev: DraftRow[]) => DraftRow[]) {
    setRows((prev) => applyDuplicateFlags(updater(prev)));
  }

  function selectMaterial(key: string, item: WikiListItem | null) {
    updateRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        if (!item) {
          return {
            ...row,
            flowerWikiId: null,
            chineseName: "",
            englishName: "",
            colorTags: [],
          };
        }
        return {
          ...row,
          flowerWikiId: item.id,
          chineseName: item.chineseName,
          englishName: item.englishName,
          colorTags: item.colorTags,
        };
      })
    );
  }

  async function handleSave() {
    const name = recipeName.trim();
    if (!name) {
      showToast("请填写配方名称", "error");
      return;
    }

    const flagged = applyDuplicateFlags(rows);
    if (flagged.some((r) => r.duplicateError)) {
      setRows(flagged);
      showToast("配方中存在重复花材，请合并数量", "error");
      return;
    }

    const ingredients = flagged
      .filter((r) => r.flowerWikiId)
      .map((r) => ({
        flowerWikiId: r.flowerWikiId!,
        quantity: r.quantity,
      }));

    if (ingredients.length === 0) {
      showToast("请至少添加一种大仓物料", "error");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name,
        packagingKitId: selectedPackagingKitId || null,
        ingredients,
      };
      const isCreate = mode === "create" || !selectedId;
      const url = isCreate
        ? "/api/admin/wms/recipes"
        : `/api/admin/wms/recipes/${selectedId}`;
      const res = await fetch(url, {
        method: isCreate ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: {
          message?: string;
          recipe?: { id: string; recipeCode: string };
        };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "保存配方失败");
      }

      const code = json.data?.recipe?.recipeCode;
      if (isCreate && code) {
        showToast(`配方创建成功，系统单号：${code}`, "success");
      } else {
        showToast(json.data?.message ?? "配方已保存", "success");
      }

      await loadList();

      if (isCreate) {
        startCreate();
      } else if (json.data?.recipe?.id) {
        await loadRecipe(json.data.recipe.id);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存配方失败", "error");
    } finally {
      setSaving(false);
    }
  }

  const filtered = items.filter((item) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      item.recipeCode.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      (item.packagingKitName?.toLowerCase().includes(q) ?? false) ||
      item.ingredientSummary.toLowerCase().includes(q)
    );
  });

  const hasDuplicate = rows.some((r) => r.duplicateError);

  return (
    <div className="relative">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">
            标准配方研发中心
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            标准工艺公式 · 不触发物理入库 · 商品 SPU 挂载引用
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={startCreate}>
          🧪 研发新配方清单
        </Button>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm md:max-h-[calc(100vh-12rem)] md:overflow-y-auto">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索系统单号 / 配方名称 / 花材…"
            className="mb-4 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
          />

          {loading ? (
            <p className="py-12 text-center text-sm text-zinc-400">加载中…</p>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-400">
              暂无配方，点击右上角开始研发
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {filtered.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void loadRecipe(item.id)}
                    className={`w-full px-2 py-3 text-left transition-colors ${
                      selectedId === item.id
                        ? "bg-zinc-100 ring-1 ring-inset ring-zinc-300"
                        : "hover:bg-zinc-50"
                    }`}
                  >
                    <p className="text-sm font-semibold text-zinc-900">
                      {item.recipeCode} - {item.name}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-600">
                      {item.ingredientSummary}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {item.ingredientCount} 项物料 · 挂载 {item.productCount}{" "}
                      商品
                    </p>
                    <p className="mt-1 text-xs text-emerald-700">
                      包装：
                      {item.packagingKitName
                        ? `${item.packagingKitName} · ¥${item.packagingKitStandardCost}`
                        : "未绑定"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      BOM 成本：花材 ¥{item.standardMaterialCost} · 包装 ¥
                      {item.standardPackagingCost} · 合计 ¥
                      {item.standardTotalCost}
                    </p>
                    <p
                      className={`mt-1 text-xs font-medium ${
                        item.missingStandardCostCount > 0
                          ? "text-amber-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {item.missingStandardCostCount > 0
                        ? `成本缺失：${item.missingStandardCostCount} 个花材未设置标准成本`
                        : "成本完整：所有花材均已设置标准成本"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="md:sticky md:top-4 md:self-start">
          <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  {mode === "create" ? "新建标准配方" : "编辑标准配方"}
                </h3>
                {mode === "edit" ? (
                  <p className="mt-1 text-xs font-medium text-zinc-700">
                    系统单号：{recipeCode}
                  </p>
                ) : null}
                {mode === "edit" && productCount > 0 ? (
                  <p className="mt-1 text-xs text-amber-600">
                    已有 {productCount} 个商品挂载此配方，修改将同步影响生产拆解
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? "保存中…" : "保存配方"}
              </Button>
            </div>

            <Input
              label="🏷️ 配方名称"
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              placeholder="例如：七夕蓝色妖姬标准配方"
              disabled={saving}
              required
            />

            <label className="mt-4 block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">
                🎁 包装方案
              </span>
              <select
                value={selectedPackagingKitId}
                onChange={(e) => setSelectedPackagingKitId(e.target.value)}
                disabled={saving}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
              >
                <option value="">不绑定包装方案</option>
                {packagingKits.map((kit) => (
                  <option key={kit.id} value={kit.id}>
                    {kit.name} · ¥{kit.standardCost}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500">
                用于订单毛利核算，不影响花材 RecipeLine 逻辑。
              </p>
            </label>

            {costPreview ? (
              <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-emerald-950">
                      BOM 标准成本预览
                    </p>
                    <p className="mt-1 text-xs text-emerald-800">
                      原始花材 ¥{costPreview.materialCost} · 包装 ¥
                      {costPreview.packagingCost} · 原始合计 ¥
                      {costPreview.totalCost}
                    </p>
                    {costPreview.lossModelStandardTotalCost ? (
                      <p className="mt-1 text-xs text-sky-800">
                        标准损耗模式合计 ¥
                        {costPreview.lossModelStandardTotalCost} · 损耗增加 ¥
                        {costPreview.lossModelExtraCost ?? "0.00"}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      costPreview.isComplete
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {costPreview.isComplete
                      ? "成本完整"
                      : `成本缺失 ${costPreview.missingStandardCostCount} 项`}
                  </span>
                </div>
                <p className="mb-2 text-[11px] text-emerald-800">
                  配方成本中的损耗模型基于花材档案可用率估算，用于定价和产品判断，不代表实际报损流水。
                </p>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-emerald-100 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-emerald-50 text-emerald-900">
                      <tr>
                        <th className="px-2 py-2">花材</th>
                        <th className="px-2 py-2 text-right">数量</th>
                        <th className="px-2 py-2 text-right">标准单价</th>
                        <th className="px-2 py-2 text-right">可用率</th>
                        <th className="px-2 py-2 text-right">原始行成本</th>
                        <th className="px-2 py-2 text-right">损耗后行成本</th>
                        <th className="px-2 py-2 text-right">增加成本</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-emerald-50">
                      {(costPreview.lossModelLines ?? costPreview.lines).map(
                        (line) => (
                        <tr key={line.flowerWikiId}>
                          <td className="px-2 py-2">
                            <span className="font-medium text-zinc-900">
                              {line.flowerName}
                            </span>
                            {line.warning ? (
                              <p className="mt-0.5 text-amber-700">
                                {line.warning}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {line.quantityNeeded}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {line.standardUnitCost
                              ? `¥${Number(line.standardUnitCost).toFixed(2)}`
                              : "未设置"}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {"usableRate" in line && line.usableRate
                              ? formatPercent(line.usableRate)
                              : "—"}
                          </td>
                          <td className="px-2 py-2 text-right">
                            ¥{"rawLineCost" in line ? line.rawLineCost : line.lineCost}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold">
                            ¥{"adjustedLineCost" in line ? line.adjustedLineCost : line.lineCost}
                          </td>
                          <td className="px-2 py-2 text-right text-sky-700">
                            ¥{"lossModelExtraCost" in line ? line.lossModelExtraCost : "0.00"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="mt-4 space-y-4">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className={`rounded-lg border p-3 ${
                    row.duplicateError
                      ? "border-red-300 bg-red-50/40"
                      : "border-zinc-200 bg-zinc-50/50"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <FlowerMaterialSelect
                        value={row.flowerWikiId}
                        disabled={saving}
                        onChange={(item) => selectMaterial(row.key, item)}
                      />
                      {row.duplicateError ? (
                        <p className="mt-1 text-sm font-medium text-red-600">
                          {row.duplicateError}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <QuantityStepper
                        value={row.quantity}
                        min={1}
                        disabled={saving}
                        onChange={(qty) =>
                          updateRows((prev) =>
                            prev.map((r) =>
                              r.key === row.key ? { ...r, quantity: qty } : r
                            )
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label="删除该行"
                        disabled={saving}
                        onClick={() =>
                          updateRows((prev) =>
                            prev.filter((r) => r.key !== row.key)
                          )
                        }
                        className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                className="w-full"
                onClick={() => updateRows((prev) => [...prev, emptyRow()])}
              >
                ➕ 添加大仓物料
              </Button>

              {hasDuplicate ? (
                <p className="text-center text-sm text-red-600">
                  存在重复花材，请删除多余行或合并数量后再保存
                </p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-[60] rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
