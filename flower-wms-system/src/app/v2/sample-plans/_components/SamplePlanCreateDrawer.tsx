"use client";

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { ChevronRight, Flower2, Leaf, Search, X } from "lucide-react";
import type { SamplePlanCompanionRecommendation } from "@/v2/domain/sample-planning";
import type { V2ActionResult } from "../../_lib/action-result";
import { StatusBadge, button, input } from "../../_components/V2Ui";
import { V2DrawerForm } from "../../_components/V2Drawer";
import type { SampleOption, SampleRecipeItem } from "../../samples/_components/SampleEditors";
import { sampleDisplayName } from "../../_lib/sample-display";
import { filterSampleOptions } from "../sample-option-search";
import {
  summarizeCandidateSelection,
  toggleCandidateSelection,
} from "../sample-plan-selection";

export type SamplePlanRecommendInput = {
  mainSampleId: string;
  plannedCount: number;
};

export type SamplePlanRecommendationResult =
  | {
    ok: true;
    candidates: SamplePlanCompanionRecommendation[];
    eligibleCount: number;
    requestedCount: number;
  }
  | { ok: false; error: string };

const MAX_PLANNED_SAMPLES = 12;
const DEFAULT_PLANNED_SAMPLES = 6;
const MAIN_SAMPLE_OPTION_LIMIT = 8;

function formatRate(value: number): string {
  const percent = Math.round(value * 1000) / 10;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

function formatQuantity(value: number, unit: string | null): string {
  const rounded = Math.round((value + 1e-9) * 1000) / 1000;
  return unit ? `${rounded} ${unit}` : `${rounded}`;
}

function recipeKindRank(kind: string): number {
  if (kind === "FLOWER") return 0;
  if (kind === "FOLIAGE") return 1;
  return 2;
}

function RecipeIcon({ kind }: { kind: string }) {
  if (kind === "FOLIAGE") {
    return <Leaf aria-hidden className="size-4 shrink-0" />;
  }
  return <Flower2 aria-hidden className="size-4 shrink-0" />;
}

function sortRecipe(recipe: readonly SampleRecipeItem[]): SampleRecipeItem[] {
  return [...recipe].sort((left, right) =>
    recipeKindRank(left.kind) - recipeKindRank(right.kind)
    || left.name.localeCompare(right.name)
  );
}

/**
 * Single-main creation drawer for sample plans.
 *
 * The main sample is picked through a fuzzy combobox (code/name/classification)
 * and its full recipe is previewed before requesting recommendations. "获取推荐"
 * trials each optional sample against that single main sample and returns ranked
 * candidates with expected reuse rate/quantity and a substitution hint. Every
 * recommendation row can expand into a per-material reuse breakdown, where
 * "其余需求" is the requirement still uncovered after the main sample's ideal
 * disassembly. Selected recommendations are submitted with the main sample, and
 * the server action creates and calculates the plan together.
 *
 * Sample names are the only label in this drawer. Generated `SMP-…` codes are
 * deliberately not shown: UUID-length codes made the picker unreadable. The
 * name falls back to a short code only when it is empty or identical to the
 * code.
 */
export function SamplePlanCreateDrawer({
  samples,
  createAction,
  recommendAction,
}: {
  samples: SampleOption[];
  createAction: (formData: FormData) => Promise<V2ActionResult>;
  recommendAction: (input: SamplePlanRecommendInput) => Promise<SamplePlanRecommendationResult>;
}) {
  const availableSamples = useMemo(
    () => samples.filter((sample) => sample.materialCount > 0),
    [samples],
  );
  const sampleById = useMemo(
    () => new Map(availableSamples.map((sample) => [sample.id, sample])),
    [availableSamples],
  );
  const initialSample = availableSamples[0];
  const [mainSampleId, setMainSampleId] = useState(initialSample?.id ?? "");
  const [mainQuery, setMainQuery] = useState(
    initialSample ? sampleDisplayName(initialSample) : "",
  );
  const [mainPickerOpen, setMainPickerOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const [plannedCountInput, setPlannedCountInput] = useState(String(DEFAULT_PLANNED_SAMPLES));
  const [planName, setPlanName] = useState("");
  const [candidates, setCandidates] = useState<SamplePlanCompanionRecommendation[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [recommendNote, setRecommendNote] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [recommendPending, startRecommend] = useTransition();
  const mainPickerRef = useRef<HTMLDivElement>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const selectAllCandidatesRef = useRef<HTMLInputElement>(null);
  const mainListId = useId();
  const mainHintId = `${mainListId}-hint`;

  const parsedPlannedCount = Number(plannedCountInput);
  const plannedCount = Number.isInteger(parsedPlannedCount) && parsedPlannedCount >= 1
    ? Math.min(MAX_PLANNED_SAMPLES, parsedPlannedCount)
    : 1;
  const maxCompanions = Math.max(0, plannedCount - 1);
  const mainSample = sampleById.get(mainSampleId);
  const selectedCount = (mainSample ? 1 : 0) + selectedIds.length;
  const progress = plannedCount > 0
    ? Math.min(100, Math.round((selectedCount / plannedCount) * 100))
    : 0;

  const selectedRows = selectedIds.flatMap((sampleId) => {
    const candidate = candidates?.find((row) => row.sampleId === sampleId);
    if (candidate) return [{ sampleId, code: candidate.code, name: candidate.name }];
    const option = sampleById.get(sampleId);
    return option ? [{ sampleId, code: option.code, name: option.name }] : [];
  });

  const candidateIds = candidates?.map((row) => row.sampleId) ?? [];
  const candidateSelection = summarizeCandidateSelection(
    selectedIds,
    candidateIds,
    maxCompanions,
  );

  const librarySamples = useMemo(() => {
    return filterSampleOptions(availableSamples, libraryQuery)
      .filter((sample) => sample.id !== mainSampleId && !selectedIds.includes(sample.id));
  }, [availableSamples, libraryQuery, mainSampleId, selectedIds]);

  const mainRecipe = useMemo(
    () => sortRecipe(mainSample?.recipe ?? []),
    [mainSample],
  );

  // With a chosen sample, focusing the input shows the full eligible list again
  // instead of filtering on the label we just wrote into it.
  const pickerQuery = mainSample && mainQuery === sampleDisplayName(mainSample) ? "" : mainQuery;
  const allPickerMatches = useMemo(
    () => filterSampleOptions(availableSamples, pickerQuery),
    [availableSamples, pickerQuery],
  );
  const pickerMatches = allPickerMatches.slice(0, MAIN_SAMPLE_OPTION_LIMIT);

  useEffect(() => {
    if (!mainPickerOpen) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!mainPickerRef.current?.contains(event.target as Node)) {
        setMainPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [mainPickerOpen]);

  useEffect(() => {
    const input = selectAllCandidatesRef.current;
    if (input) input.indeterminate = candidateSelection.partiallySelected;
  }, [candidateSelection.partiallySelected]);

  const resetRecommendationState = () => {
    setCandidates(null);
    setRecommendError(null);
    setRecommendNote(null);
    setExpandedIds([]);
  };

  const resetForm = () => {
    const first = availableSamples[0];
    setMainSampleId(first?.id ?? "");
    setMainQuery(first ? sampleDisplayName(first) : "");
    setMainPickerOpen(false);
    setActiveOptionIndex(0);
    setPlannedCountInput(String(DEFAULT_PLANNED_SAMPLES));
    setPlanName("");
    setSelectedIds([]);
    setShowLibrary(false);
    setLibraryQuery("");
    resetRecommendationState();
  };

  const selectMainSample = (sample: SampleOption) => {
    setMainQuery(sampleDisplayName(sample));
    setMainPickerOpen(false);
    setActiveOptionIndex(0);
    if (sample.id === mainSampleId) return;
    setMainSampleId(sample.id);
    setSelectedIds([]);
    setShowLibrary(false);
    setLibraryQuery("");
    resetRecommendationState();
  };

  const clearMainSample = () => {
    setMainQuery("");
    setMainPickerOpen(false);
    setActiveOptionIndex(0);
    if (!mainSampleId) {
      mainInputRef.current?.focus();
      return;
    }
    setMainSampleId("");
    setSelectedIds([]);
    setShowLibrary(false);
    resetRecommendationState();
    mainInputRef.current?.focus();
  };

  const handleMainQueryChange = (value: string) => {
    setMainQuery(value);
    setMainPickerOpen(true);
    setActiveOptionIndex(0);
    if (mainSample && value !== sampleDisplayName(mainSample)) {
      // Editing the text invalidates the previous choice, so its trial results
      // and selected companions must be discarded together with it.
      setMainSampleId("");
      setSelectedIds([]);
      setShowLibrary(false);
      resetRecommendationState();
    }
  };

  const openMainPicker = () => {
    setMainPickerOpen(true);
    // Highlight the current main sample so Enter does not silently replace it.
    const selectedIndex = mainSampleId
      ? allPickerMatches.findIndex((option) => option.id === mainSampleId)
      : -1;
    setActiveOptionIndex(selectedIndex >= 0 ? selectedIndex : 0);
  };

  const handleMainQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (mainPickerOpen) {
        event.preventDefault();
        // The drawer also listens for Escape on `document`; stop the native
        // event so closing the suggestion list does not close the drawer.
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        setMainPickerOpen(false);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!mainPickerOpen) {
        setMainPickerOpen(true);
        setActiveOptionIndex(event.key === "ArrowDown" ? 0 : Math.max(0, pickerMatches.length - 1));
        return;
      }
      setActiveOptionIndex((current) => {
        if (pickerMatches.length === 0) return 0;
        const next = current + (event.key === "ArrowDown" ? 1 : -1);
        if (next < 0) return pickerMatches.length - 1;
        if (next >= pickerMatches.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter" && mainPickerOpen) {
      const match = pickerMatches[activeOptionIndex] ?? pickerMatches[0];
      if (!match) return;
      event.preventDefault();
      selectMainSample(match);
    }
  };

  const handlePlannedCountChange = (value: string) => {
    if (value.trim() === "") {
      setPlannedCountInput("");
      setSelectedIds([]);
      resetRecommendationState();
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(MAX_PLANNED_SAMPLES, Math.max(1, Math.trunc(parsed)));
    setPlannedCountInput(String(next));
    setSelectedIds((current) => current.slice(0, Math.max(0, next - 1)));
    resetRecommendationState();
  };

  const toggleCandidate = (sampleId: string) => {
    setSelectedIds((current) => {
      if (current.includes(sampleId)) {
        return current.filter((id) => id !== sampleId);
      }
      if (current.length >= maxCompanions) return current;
      return [...current, sampleId];
    });
  };

  const toggleAllCandidates = () => {
    setSelectedIds((current) => {
      const summary = summarizeCandidateSelection(current, candidateIds, maxCompanions);
      return toggleCandidateSelection(
        current,
        candidateIds,
        maxCompanions,
        summary.allSelected,
      );
    });
  };

  const toggleExpanded = (sampleId: string) => {
    setExpandedIds((current) => current.includes(sampleId)
      ? current.filter((id) => id !== sampleId)
      : [...current, sampleId]);
  };

  const handleRecommend = () => {
    if (!mainSample || recommendPending) return;
    setRecommendError(null);
    setRecommendNote(null);
    startRecommend(async () => {
      try {
        const result = await recommendAction({
          mainSampleId: mainSample.id,
          plannedCount,
        });
        if (!result.ok) {
          setCandidates([]);
          setRecommendError(result.error);
          return;
        }
        setCandidates(result.candidates);
        setExpandedIds([]);
        setSelectedIds((current) => {
          const allowed = new Set(result.candidates.map((row) => row.sampleId));
          return current
            .filter((sampleId) => allowed.has(sampleId))
            .slice(0, Math.max(0, plannedCount - 1));
        });
        if (result.candidates.length < result.requestedCount) {
          setRecommendNote(
            `仅找到 ${result.candidates.length} 个可用候选（计划 ${plannedCount} 个样品）`,
          );
        }
      } catch (cause) {
        setCandidates([]);
        setRecommendError(cause instanceof Error ? cause.message : "获取推荐失败");
      }
    });
  };

  return (
    <V2DrawerForm
      triggerLabel="新建打样计划"
      title="创建打样计划"
      action={createAction}
      submitLabel="计算打样计划"
      size="2xl"
      triggerClassName={button}
      submitDisabled={!mainSample || !planName.trim()}
      onSuccess={resetForm}
    >
      <input type="hidden" name="mainSampleId" value={mainSampleId} />
      <input type="hidden" name="plannedCount" value={String(plannedCount)} />
      <input type="hidden" name="selectedSampleIds" value={JSON.stringify(selectedIds)} />

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <label className="block text-sm font-medium text-stone-700">
          打样计划名称 <span className="text-red-600">*</span>
          <input
            className={`${input} mt-1`}
            type="text"
            name="name"
            maxLength={100}
            autoComplete="off"
            required
            placeholder="例如：2026 圣诞红系列打样"
            value={planName}
            onChange={(event) => setPlanName(event.target.value)}
          />
        </label>
        <p className="mt-1 text-xs text-stone-500">
          名称会显示在打样计划列表中。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(160px,1fr)] md:items-start">
          <div className="min-w-0">
            <label htmlFor={mainListId} className="block text-sm font-medium text-stone-700">
              主样品
            </label>
            <div ref={mainPickerRef} className="relative mt-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400"
              />
              <input
                ref={mainInputRef}
                id={mainListId}
                type="text"
                role="combobox"
                autoComplete="off"
                aria-expanded={mainPickerOpen}
                aria-controls={`${mainListId}-list`}
                aria-autocomplete="list"
                aria-activedescendant={
                  mainPickerOpen && pickerMatches[activeOptionIndex]
                    ? `${mainListId}-option-${pickerMatches[activeOptionIndex]!.id}`
                    : undefined
                }
                aria-describedby={mainHintId}
                className={`${input} pl-9 pr-9`}
                placeholder="输入样品编号或名称搜索"
                value={mainQuery}
                onChange={(event) => handleMainQueryChange(event.target.value)}
                onFocus={openMainPicker}
                onKeyDown={handleMainQueryKeyDown}
              />
              {mainQuery ? (
                <button
                  type="button"
                  aria-label="清除主样品"
                  onClick={clearMainSample}
                  className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
                >
                  <X aria-hidden className="size-4" />
                </button>
              ) : null}
              {mainPickerOpen ? (
                <ul
                  id={`${mainListId}-list`}
                  role="listbox"
                  aria-label="主样品搜索结果"
                  className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
                >
                  {pickerMatches.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-stone-500">没有匹配的样品</li>
                  ) : (
                    pickerMatches.map((option, index) => {
                      const active = index === activeOptionIndex;
                      return (
                        <li key={option.id}>
                          <button
                            type="button"
                            role="option"
                            id={`${mainListId}-option-${option.id}`}
                            aria-selected={active}
                            onMouseEnter={() => setActiveOptionIndex(index)}
                            onClick={() => selectMainSample(option)}
                            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                              active
                                ? "bg-emerald-50 text-emerald-950"
                                : "text-stone-800 hover:bg-stone-50"
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {sampleDisplayName(option)}
                            </span>
                            <span className="shrink-0 text-xs text-stone-500">
                              {option.materialCount} 项物料
                            </span>
                          </button>
                        </li>
                      );
                    })
                  )}
                  {allPickerMatches.length > MAIN_SAMPLE_OPTION_LIMIT ? (
                    <li className="border-t border-stone-100 px-3 py-1.5 text-[11px] text-stone-500">
                      匹配 {allPickerMatches.length} 个，仅显示前 {MAIN_SAMPLE_OPTION_LIMIT} 个；继续输入可缩小范围。
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
            <p id={mainHintId} className="mt-1 text-xs text-stone-500">
              支持按样品编号或名称模糊搜索
            </p>
          </div>
          <label className="block text-sm font-medium text-stone-700">
            计划制作样品数（含主样品）
            <input
              className={`${input} mt-1`}
              type="number"
              min={1}
              max={MAX_PLANNED_SAMPLES}
              step={1}
              value={plannedCountInput}
              onChange={(event) => handlePlannedCountChange(event.target.value)}
            />
          </label>
          <div className="md:pt-6">
            <button
              type="button"
              className={`${button} w-full`}
              onClick={handleRecommend}
              disabled={!mainSample || recommendPending}
            >
              {recommendPending ? "获取推荐中…" : "获取推荐"}
            </button>
          </div>
        </div>
        {availableSamples.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            还没有可用于打样的样品。请先在样品库建立花材搭配。
          </p>
        ) : null}
      </section>

      {mainSample ? (
        <section
          aria-labelledby={`${mainListId}-recipe-title`}
          className="rounded-xl border border-stone-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3
              id={`${mainListId}-recipe-title`}
              className="shrink-0 text-sm font-semibold text-stone-900"
            >
              主样品配方
            </h3>
            {mainRecipe.length === 0 ? (
              <p className="text-sm text-stone-500">该样品暂无配方明细。</p>
            ) : (
              <ul className="flex min-w-0 flex-wrap gap-2">
                {mainRecipe.map((item) => (
                  <li
                    key={item.materialId}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-100"
                  >
                    <RecipeIcon kind={item.kind} />
                    <span className="font-medium">{item.name}</span>
                    <span className="tabular-nums">{formatQuantity(item.quantity, item.baseUnit)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-lg font-semibold text-stone-900">推荐样品</h3>
            {candidates ? (
              <span className="text-sm text-stone-500">{candidates.length} 个候选</span>
            ) : null}
          </div>

          {recommendError ? (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-900"
            >
              {recommendError}
            </p>
          ) : null}
          {recommendNote ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              {recommendNote}
            </p>
          ) : null}

          {candidates === null ? (
            <p className="mt-3 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-500">
              选择主样品和计划制作样品数后，点击“获取推荐”。
            </p>
          ) : candidates.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-500">
              没有找到可推荐的搭配样品。可调整计划制作样品数，或从样品库手动添加。
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200">
              <table className="min-w-full text-sm">
                <thead className="bg-emerald-50 text-left text-xs text-emerald-900">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        ref={selectAllCandidatesRef}
                        type="checkbox"
                        className="size-4 rounded border-stone-300 accent-emerald-700"
                        checked={candidateSelection.allSelected}
                        disabled={candidateSelection.disabled}
                        onChange={toggleAllCandidates}
                        aria-label="全选推荐样品"
                        title="全选推荐样品"
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">样品</th>
                    <th className="px-3 py-2 text-right font-medium">预计复用率</th>
                    <th className="px-3 py-2 text-right font-medium">预计复用量</th>
                    <th className="px-3 py-2 font-medium">换料</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {candidates.map((candidate) => {
                    const checked = selectedIds.includes(candidate.sampleId);
                    const disabled = !checked && selectedIds.length >= maxCompanions;
                    const expanded = expandedIds.includes(candidate.sampleId);
                    const detailId = `${mainListId}-recipe-${candidate.sampleId}`;
                    const displayName = sampleDisplayName(candidate);
                    return (
                      <Fragment key={candidate.sampleId}>
                        <tr className={expanded ? "bg-emerald-50/30" : "hover:bg-stone-50"}>
                          <td className="px-3 py-3 align-middle">
                            <input
                              type="checkbox"
                              className="size-4 rounded border-stone-300 accent-emerald-700"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleCandidate(candidate.sampleId)}
                              aria-label={`选择 ${displayName}`}
                            />
                          </td>
                          <td className="px-3 py-3 align-middle font-medium text-stone-900">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleExpanded(candidate.sampleId)}
                                aria-expanded={expanded}
                                aria-controls={detailId}
                                aria-label={`${expanded ? "收起" : "展开"}「${displayName}」的花材配方`}
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-stone-500 transition hover:bg-emerald-100 hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
                              >
                                <ChevronRight
                                  aria-hidden
                                  className={`size-4 transition-transform ${expanded ? "rotate-90" : ""}`}
                                />
                              </button>
                              <span className="min-w-0 truncate font-medium">{displayName}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right align-middle tabular-nums text-stone-800">
                            {formatRate(candidate.reuseRate)}
                          </td>
                          <td className="px-3 py-3 text-right align-middle tabular-nums text-stone-800">
                            {formatQuantity(candidate.reusedQty, candidate.baseUnit)}
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <StatusBadge tone={candidate.requiresSubstitution ? "warning" : "success"}>
                              {candidate.requiresSubstitution ? "需确认换料" : "直接复用"}
                            </StatusBadge>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr id={detailId}>
                            <td colSpan={5} className="bg-emerald-50/50 px-3 pb-3 pt-0">
                              <div className="rounded-lg border border-emerald-100 bg-white/80 p-3">
                                <p className="text-xs font-semibold text-emerald-900">花材配方</p>
                                {candidate.materials.length === 0 ? (
                                  <p className="mt-2 text-xs text-stone-500">该样品暂无配方明细。</p>
                                ) : (
                                  <table className="mt-2 min-w-full text-xs">
                                    <thead className="text-left text-emerald-900/90">
                                      <tr>
                                        <th className="pb-1.5 pr-3 font-medium">花材</th>
                                        <th className="pb-1.5 pr-3 text-right font-medium">需求</th>
                                        <th className="pb-1.5 pr-3 text-right font-medium">预计复用</th>
                                        <th className="pb-1.5 text-right font-medium">其余需求</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-emerald-100/80">
                                      {candidate.materials.map((material) => (
                                        <tr key={material.materialId}>
                                          <td className="py-1.5 pr-3 text-stone-800">{material.name}</td>
                                          <td className="py-1.5 pr-3 text-right tabular-nums text-stone-800">
                                            {formatQuantity(material.requiredQty, material.baseUnit)}
                                          </td>
                                          <td className="py-1.5 pr-3 text-right tabular-nums">
                                            <span
                                              className={material.reusedQty > 0
                                                ? "font-semibold text-emerald-700"
                                                : "text-stone-500"}
                                            >
                                              {formatQuantity(material.reusedQty, material.baseUnit)}
                                            </span>
                                            {material.reusedQty > 0 && mainSample ? (
                                              <span className="block text-[11px] text-emerald-700/80">
                                                来自 {sampleDisplayName(mainSample)}
                                              </span>
                                            ) : null}
                                          </td>
                                          <td className="py-1.5 text-right tabular-nums text-stone-800">
                                            {formatQuantity(material.remainingQty, material.baseUnit)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-stone-500">候选逐个试算，选定后统一计算。</p>
        </section>

        <aside className="min-w-0 rounded-xl border border-stone-200 bg-white p-4">
          <h3 className="text-lg font-semibold text-stone-900">已选样品</h3>
          <p className="mt-2 text-sm text-stone-600">
            已选 {selectedCount} / 计划 {plannedCount}
          </p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label="已选样品进度"
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-stone-200"
          >
            <div
              className="h-full rounded-full bg-emerald-700 transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          {selectedCount < plannedCount ? (
            <p className="mt-2 text-[11px] text-stone-500">
              还可再选 {plannedCount - selectedCount} 个样品；也可以直接计算当前已选样品。
            </p>
          ) : null}

          <div className="mt-4 space-y-2">
            {mainSample ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-stone-900">
                  {sampleDisplayName(mainSample)}
                </span>
                <StatusBadge tone="success">主样品</StatusBadge>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-2.5 text-sm text-stone-500">
                尚未选择主样品
              </p>
            )}
            {selectedRows.map((row) => {
              const displayName = sampleDisplayName(row);
              return (
                <div
                  key={row.sampleId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-stone-900">{displayName}</span>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-stone-400 transition hover:text-red-600"
                    onClick={() => toggleCandidate(row.sampleId)}
                    aria-label={`移除 ${displayName}`}
                  >
                    移除
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-emerald-700 bg-white px-3 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => setShowLibrary((current) => !current)}
            disabled={!mainSample || maxCompanions === 0}
            aria-expanded={showLibrary}
          >
            + 从样品库添加
          </button>
          {maxCompanions === 0 ? (
            <p className="mt-2 text-[11px] text-stone-500">
              计划只包含主样品；提高计划制作样品数后可添加搭配样品。
            </p>
          ) : null}

          {showLibrary ? (
            <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-2">
              <input
                className={input}
                type="search"
                placeholder="搜索样品编号或名称"
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
              />
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {librarySamples.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-stone-500">没有更多可添加的样品。</p>
                ) : (
                  librarySamples.map((sample) => {
                    const displayName = sampleDisplayName(sample);
                    return (
                      <button
                        type="button"
                        key={sample.id}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-left text-sm transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => toggleCandidate(sample.id)}
                        disabled={selectedIds.length >= maxCompanions}
                      >
                        <span className="min-w-0 flex-1 truncate">{displayName}</span>
                        <span className="shrink-0 text-xs font-medium text-emerald-700">添加</span>
                      </button>
                    );
                  })
                )}
              </div>
              <p className="text-[11px] text-stone-500">
                手动添加的样品不参与推荐试算；提交后与其他已选样品统一计算复用。
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </V2DrawerForm>
  );
}
