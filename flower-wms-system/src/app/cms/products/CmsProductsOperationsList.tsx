"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ActionEmptyState } from "@/components/admin/ActionEmptyState";
import { ProductOccasionTagsBadge } from "@/components/cms/ProductOccasionTagsBadge";
import { ProductOperationSummaryBadge } from "@/components/cms/ProductOperationSummaryBadge";
import { ProductDecisionHealthBadge } from "@/components/product-decision/ProductDecisionBadge";
import { Badge } from "@/components/ui/Badge";
import {
  CMS_OCCASION_TAG_OPTIONS,
  CMS_POSITIONING_TAG_OPTIONS,
  toTagDisplayList,
} from "@/lib/cms-product-tags";
import type { CmsProductCategoryItem } from "@/lib/cms-product-categories";
import { formatPercent } from "@/lib/format-money";
import { formatNullable } from "@/lib/format-display";
import type { PublishReadinessStatus } from "@/services/cms-product-validation-pure";

type SummaryItem = {
  id: string;
  name: string;
  isActive: boolean;
  mainImage: string;
  minPrice: string;
  tags: {
    occasionTags: string[];
    positioningTags: string[];
    colorTags: string[];
  };
  publishReadiness: {
    overallStatus: PublishReadinessStatus;
    score: number;
    canPublish: boolean;
    canPromote: boolean;
  };
  productDecisionSummary: {
    healthStatus: string | null;
    healthStatusLabel: string | null;
    standardGrossMargin: number | null;
  };
  hasRecommendationSlot: boolean;
};

type Props = {
  categoryConfig: CmsProductCategoryItem[];
  initialCategoryId?: string;
};

const READINESS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "全部校验状态" },
  { value: "READY", label: "可上架" },
  { value: "WARNING", label: "需检查" },
  { value: "BLOCKED", label: "不可上架" },
  { value: "INCOMPLETE", label: "信息不完整" },
];

export function CmsProductsOperationsList({ categoryConfig }: Props) {
  const [items, setItems] = useState<SummaryItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [occasionTag, setOccasionTag] = useState("");
  const [positioningTag, setPositioningTag] = useState("");
  const [readinessStatus, setReadinessStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const hasActiveFilters = Boolean(
    keyword.trim() ||
      categoryId ||
      status ||
      occasionTag ||
      positioningTag ||
      readinessStatus
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (categoryId) params.set("categoryId", categoryId);
      if (status) params.set("status", status);
      if (occasionTag) params.set("occasionTag", occasionTag);
      if (positioningTag) params.set("positioningTag", positioningTag);
      if (readinessStatus) params.set("readinessStatus", readinessStatus);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      const res = await fetch(
        `/api/admin/cms/products/operation-summaries?${params}`
      );
      const json = (await res.json()) as {
        success: boolean;
        data?: { items: SummaryItem[]; total: number };
        error?: string;
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "商品运营数据加载失败，请稍后重试。");
      }
      setItems(json.data?.items ?? []);
      setTotal(json.data?.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [
    keyword,
    categoryId,
    status,
    occasionTag,
    positioningTag,
    readinessStatus,
    page,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function handleDelete(id: string) {
    if (!window.confirm("确定要删除该商品吗？删除后将在前台下架。")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/cms/products/${id}`, { method: "DELETE" });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "删除失败");
      }
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <input
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            placeholder="搜索商品名"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
          <select
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部分类</option>
            {categoryConfig.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            <option value="active">已上架</option>
            <option value="inactive">未上架</option>
          </select>
          <select
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            value={occasionTag}
            onChange={(e) => {
              setOccasionTag(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部场景</option>
            {CMS_OCCASION_TAG_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            value={positioningTag}
            onChange={(e) => {
              setPositioningTag(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部定位</option>
            {CMS_POSITIONING_TAG_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            value={readinessStatus}
            onChange={(e) => {
              setReadinessStatus(e.target.value);
              setPage(1);
            }}
          >
            {READINESS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">正在加载商品运营摘要…</p>
      ) : error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : items.length === 0 && !hasActiveFilters && total === 0 ? (
        <ActionEmptyState
          title="还没有商品"
          description="请先创建商品 SPU/SKU，并为 SKU 绑定 WMS Recipe。"
          primaryActionLabel="新建商品"
          primaryActionHref="/cms/products/new"
          secondaryActionLabel="查看配方"
          secondaryActionHref="/wms/recipes"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="px-4 py-3 font-medium text-zinc-600">品名</th>
                <th className="px-4 py-3 font-medium text-zinc-600">运营标签</th>
                <th className="px-4 py-3 font-medium text-zinc-600">上架校验</th>
                <th className="px-4 py-3 font-medium text-zinc-600">产品决策</th>
                <th className="px-4 py-3 font-medium text-zinc-600">推荐位</th>
                <th className="px-4 py-3 font-medium text-zinc-600">价格</th>
                <th className="px-4 py-3 font-medium text-zinc-600">状态</th>
                <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-zinc-500">
                    暂无匹配商品
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const positioning = toTagDisplayList(
                    "positioning",
                    item.tags.positioningTags
                  ).slice(0, 2);
                  const colors = toTagDisplayList(
                    "color",
                    item.tags.colorTags
                  ).slice(0, 1);

                  return (
                    <tr key={item.id} className="hover:bg-zinc-50/50">
                      <td className="px-4 py-3">
                        <p className="font-medium">{item.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-2">
                          <ProductOccasionTagsBadge
                            tags={item.tags.occasionTags}
                          />
                          <div className="flex flex-wrap gap-1">
                            {positioning.map((t) => (
                              <span
                                key={t.key}
                                className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700"
                              >
                                {t.label}
                              </span>
                            ))}
                            {colors.map((t) => (
                              <span
                                key={t.key}
                                className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700"
                              >
                                {t.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ProductOperationSummaryBadge
                          status={item.publishReadiness.overallStatus}
                          score={item.publishReadiness.score}
                          canPromote={item.publishReadiness.canPromote}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {item.productDecisionSummary.healthStatus ? (
                          <div className="space-y-1">
                            <ProductDecisionHealthBadge
                              status={item.productDecisionSummary.healthStatus}
                              statusLabel={
                                item.productDecisionSummary.healthStatusLabel
                              }
                            />
                            <p className="text-[11px] text-zinc-500">
                              标准毛利{" "}
                              {formatNullable(
                                item.productDecisionSummary.standardGrossMargin,
                                (v) => formatPercent(v)
                              )}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.hasRecommendationSlot ? (
                          <Badge variant="info">已配置</Badge>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">¥{item.minPrice}</td>
                      <td className="px-4 py-3">
                        {item.isActive ? (
                          <Badge variant="success">上架</Badge>
                        ) : (
                          <Badge variant="default">未上架</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-3">
                          <Link
                            href={`/cms/products/${item.id}`}
                            className="text-rose-600 hover:underline"
                          >
                            编辑
                          </Link>
                          <button
                            type="button"
                            className="text-red-600 hover:underline disabled:opacity-50"
                            disabled={deletingId === item.id}
                            onClick={() => void handleDelete(item.id)}
                          >
                            {deletingId === item.id ? "删除中…" : "删除"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            className="rounded border px-3 py-1 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="text-zinc-600">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            className="rounded border px-3 py-1 disabled:opacity-50"
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}
