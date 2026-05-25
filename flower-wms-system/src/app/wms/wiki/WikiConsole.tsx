"use client";

import { useCallback, useEffect, useState } from "react";
import { ImageUploadZone } from "@/components/shared/ImageUploadZone";
import { Button } from "@/components/ui/button";
import { ToastStack } from "@/components/ui/ToastStack";
import { useToast } from "@/hooks/useToast";
import {
  EMPTY_WIKI_FORM,
  FLORAL_ROLE_LABEL,
  WIKI_ROLES,
  roleBadgeClass,
  type WikiFormPayload,
  type WikiListItem,
} from "@/lib/wiki-constants";
import { FloralRole } from "@/generated/prisma/enums";
import { parseFloralRole } from "@/lib/wiki-constants";

function photoUrl(photo: string | null | undefined) {
  if (!photo) return "";
  if (photo.startsWith("http")) return photo;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "";
  return base ? `${base.replace(/\/$/, "")}${photo}` : photo;
}

function itemToForm(item: WikiListItem): WikiFormPayload {
  return {
    photo: item.photo ?? "",
    englishName: item.englishName,
    chineseName: item.chineseName,
    colorTags: item.colorTags,
    morphology: item.morphology ?? "",
    supplySeason: item.supplySeason ?? "",
    floralRole: item.floralRole,
    maintenance: item.maintenance,
    aliasMap: item.aliasMap,
  };
}

export function WikiConsole() {
  const { toasts, show, dismiss } = useToast();
  const [items, setItems] = useState<WikiListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<WikiFormPayload>(EMPTY_WIKI_FORM);
  const [aiLoading, setAiLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQ.trim()) params.set("q", searchQ.trim());
      if (filterRole) params.set("role", filterRole);
      const res = await fetch(`/api/admin/wiki?${params}`);
      const json = (await res.json()) as {
        success?: boolean;
        data?: { items?: WikiListItem[] };
        error?: string;
      };
      if (!res.ok || !json.success) throw new Error(json.error ?? "加载失败");
      setItems(json.data?.items ?? []);
    } catch (e) {
      show(e instanceof Error ? e.message : "加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [searchQ, filterRole, show]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  function patch(patch: Partial<WikiFormPayload>) {
    setForm((p) => ({ ...p, ...patch }));
  }

  async function handleAiImage(prepared: {
    base64: string;
    mimeType: string;
    dataUrl: string;
  }) {
    setAiLoading(true);
    try {
      const res = await fetch("/api/admin/wiki/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64: prepared.base64,
          mimeType: prepared.mimeType,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: {
          fields?: {
            englishName: string;
            chineseName: string;
            colorTags: string[];
            morphology: string;
            supplySeason: string;
            floralRole: FloralRole;
            maintenance: string;
            suggestedAliases?: string[];
          };
        };
        error?: string;
      };
      const f = json.data?.fields;
      if (!res.ok || !json.success || !f) {
        throw new Error(json.error ?? "AI 生成失败");
      }
      patch({
        photo: prepared.dataUrl.startsWith("/") ? prepared.dataUrl : form.photo,
        englishName: f.englishName,
        chineseName: f.chineseName,
        colorTags: f.colorTags,
        morphology: f.morphology,
        supplySeason: f.supplySeason,
        floralRole: f.floralRole,
        maintenance: f.maintenance,
        aliasMap: { zh: f.suggestedAliases ?? [] },
      });
      setSelectedId(null);
      show("DeepSeek 已自动回填百科字段，请核对后确认入库", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "AI 失败", "error");
    } finally {
      setAiLoading(false);
    }
  }

  async function save() {
    setSubmitting(true);
    try {
      const url = selectedId ? `/api/admin/wiki/${selectedId}` : "/api/admin/wiki";
      const method = selectedId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          colorTags: form.colorTags,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { item?: WikiListItem };
      };
      if (!res.ok || !json.success) throw new Error(json.error ?? "保存失败");
      show("已入库", "success");
      await loadList();
      if (json.data?.item) {
        setSelectedId(json.data.item.id);
        setForm(itemToForm(json.data.item));
      }
    } catch (e) {
      show(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <div className="mb-6 flex justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-rose-900">花材养护 Wiki</h2>
          <p className="mt-1 text-sm text-zinc-500">
            englishName 为跨端唯一真理源 · 支持 AI 拍照构建
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setSelectedId(null);
            setForm(EMPTY_WIKI_FORM);
          }}
        >
          + 新建
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-2 space-y-3">
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="搜索中文名 / 拉丁名 / 别名"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          <select
            className="w-full rounded-lg border px-3 py-2 text-sm"
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
          >
            <option value="">全部角色</option>
            {WIKI_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={() => void loadList()}>
            刷新列表
          </Button>
          {loading ? (
            <p className="text-sm text-zinc-500">加载中…</p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      setForm(itemToForm(item));
                    }}
                    className={`w-full rounded-xl border p-3 text-left ${
                      selectedId === item.id
                        ? "border-rose-300 bg-rose-50"
                        : "bg-white"
                    }`}
                  >
                    <p className="font-medium">{item.chineseName}</p>
                    <p className="text-xs italic text-zinc-500">{item.englishName}</p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${roleBadgeClass(item.floralRole)}`}
                    >
                      {FLORAL_ROLE_LABEL[item.floralRole]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="lg:col-span-3 rounded-xl border bg-white p-5 shadow-sm">
          <div
            className={`mb-4 rounded-xl border-2 border-dashed p-4 ${
              aiLoading ? "border-violet-300 bg-violet-50" : "border-violet-200"
            }`}
          >
            <ImageUploadZone
              label="📸 上传花卉图片让 AI 自动构建百科"
              capture
              onReady={handleAiImage}
              disabled={aiLoading}
            />
            {aiLoading && (
              <p className="mt-3 text-center text-sm font-medium text-violet-900">
                DeepSeek 正在全力检索植物学智库，为您智能生成养护 Wiki…
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              拉丁/英文名 *
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.englishName}
                onChange={(e) => patch({ englishName: e.target.value })}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              中文常用名 *
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.chineseName}
                onChange={(e) => patch({ chineseName: e.target.value })}
              />
            </label>
            <label className="text-sm">
              色系（逗号分隔）*
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.colorTags.join("，")}
                onChange={(e) =>
                  patch({
                    colorTags: e.target.value
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label className="text-sm">
              供货期
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.supplySeason ?? ""}
                onChange={(e) => patch({ supplySeason: e.target.value })}
              />
            </label>
            <label className="text-sm">
              角色 *
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.floralRole}
                onChange={(e) =>
                  patch({ floralRole: parseFloralRole(e.target.value) })
                }
              >
                {WIKI_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              形态特征
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={form.morphology ?? ""}
                onChange={(e) => patch({ morphology: e.target.value })}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              别名（逗号分隔）
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={(form.aliasMap?.zh ?? []).join("，")}
                onChange={(e) =>
                  patch({
                    aliasMap: {
                      zh: e.target.value
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </label>
            <label className="text-sm sm:col-span-2">
              养护指南 *
              <textarea
                className="mt-1 min-h-[180px] w-full rounded-lg border px-3 py-2 text-sm"
                value={form.maintenance}
                onChange={(e) => patch({ maintenance: e.target.value })}
              />
            </label>
          </div>

          <Button
            type="button"
            className="mt-4"
            disabled={submitting || aiLoading}
            onClick={() => void save()}
          >
            {submitting ? "提交中…" : "确认入库"}
          </Button>
        </section>
      </div>
    </>
  );
}
