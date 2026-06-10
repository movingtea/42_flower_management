"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProductOccasionTagsBadge } from "@/components/cms/ProductOccasionTagsBadge";
import { ProductDecisionHealthBadge } from "@/components/product-decision/ProductDecisionBadge";
import { ProductDecisionTags } from "@/components/product-decision/ProductDecisionTags";
import { Badge } from "@/components/ui/Badge";
import { formatCmsCategoryLabels } from "@/lib/cms-product-categories";
import type { CmsProductCategoryItem } from "@/lib/cms-product-categories";
import { formatNullable } from "@/lib/format-display";
import { formatPercent } from "@/lib/format-money";
import type { ProductDecisionTagLike } from "@/lib/product-decision-tags";

export type CmsProductListRow = {
  id: string;
  name: string;
  sku: string;
  priceLabel: string;
  marginLabel: string;
  marginStatus: "ok" | "warning" | "missing";
  quantity: number;
  status: string;
  categoryIds: string[];
  decisionHealthStatus?: string | null;
  decisionHealthLabel?: string | null;
  decisionTags?: ProductDecisionTagLike[];
  decisionStandardMargin?: number | null;
  decisionConservativeMargin?: number | null;
  occasionTags?: string[];
};

type Props = {
  rows: CmsProductListRow[];
  categoryConfig: CmsProductCategoryItem[];
};

const DELETE_CONFIRM_MESSAGE =
  "确定要删除该商品吗？删除后该商品将在前台商城下架且无法被顾客购买。";

export function CmsProductsTable({ rows, categoryConfig }: Props) {
  const router = useRouter();
  const [list, setList] = useState(rows);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<CmsProductListRow | null>(
    null
  );
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }

  async function handleConfirmDelete() {
    if (!confirmTarget) return;

    const id = confirmTarget.id;
    setDeletingId(id);
    setConfirmTarget(null);

    try {
      const res = await fetch(`/api/cms/products/${id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { message?: string };
      };

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "删除失败，请稍后重试");
      }

      setList((prev) => prev.filter((r) => r.id !== id));
      showToast("商品删除成功", "success");
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "删除失败", "error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="relative">
      {toast ? (
        <div
          role="status"
          className={`fixed right-6 top-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      {confirmTarget ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-product-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3
              id="delete-product-title"
              className="text-lg font-semibold text-zinc-900"
            >
              确认删除商品
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-zinc-600">
              {DELETE_CONFIRM_MESSAGE}
            </p>
            <p className="mt-2 text-sm font-medium text-zinc-800">
              商品：{confirmTarget.name}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                disabled={deletingId !== null}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={deletingId !== null}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deletingId ? "删除中…" : "确定删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-zinc-50">
            <tr>
              <th className="px-4 py-3 font-medium text-zinc-600">品名</th>
              <th className="px-4 py-3 font-medium text-zinc-600">分类</th>
              <th className="px-4 py-3 font-medium text-zinc-600">礼赠场景</th>
              <th className="px-4 py-3 font-medium text-zinc-600">零售价</th>
              <th className="px-4 py-3 font-medium text-zinc-600">毛利预估</th>
              <th className="px-4 py-3 font-medium text-zinc-600">产品决策</th>
              <th className="px-4 py-3 font-medium text-zinc-600">可售数量</th>
              <th className="px-4 py-3 font-medium text-zinc-600">上架状态</th>
              <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-12 text-center text-zinc-500"
                >
                  暂无商品，请点击新增商品按钮。
                  <Link href="/cms/products/new" className="text-rose-600">
                    新增商品
                  </Link>
                </td>
              </tr>
            ) : (
              list.map((p) => (
                <tr key={p.id} className="hover:bg-zinc-50/50">
                  <td className="px-4 py-3">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-zinc-500">{p.sku}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.categoryIds.length === 0 ? (
                        <span className="text-zinc-400">无分类</span>
                      ) : (
                        p.categoryIds.map((cid) => (
                          <span
                            key={cid}
                            className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
                          >
                            {formatCmsCategoryLabels(
                              [cid],
                              categoryConfig
                            )}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <ProductOccasionTagsBadge tags={p.occasionTags} />
                  </td>
                  <td className="px-4 py-3">{p.priceLabel}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.marginStatus === "ok"
                          ? "bg-emerald-50 text-emerald-700"
                          : p.marginStatus === "missing"
                            ? "bg-zinc-100 text-zinc-600"
                            : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {p.marginLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.decisionHealthStatus ? (
                      <div className="space-y-2">
                        <ProductDecisionHealthBadge
                          status={p.decisionHealthStatus}
                          statusLabel={p.decisionHealthLabel}
                        />
                        <ProductDecisionTags tags={p.decisionTags ?? []} limit={2} />
                        <p className="text-[11px] text-zinc-500">
                          标准{" "}
                          {formatNullable(p.decisionStandardMargin, (value) =>
                            formatPercent(value)
                          )}{" "}
                          / 保守{" "}
                          {formatNullable(p.decisionConservativeMargin, (value) =>
                            formatPercent(value)
                          )}
                        </p>
                      </div>
                    ) : (
                      <Link
                        href={`/wms/reports?tab=product-decisions&productId=${p.id}`}
                        className="text-xs text-rose-600 hover:underline"
                      >
                        查看产品决策
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3">{p.quantity}</td>
                  <td className="px-4 py-3">
                    {p.status === "PUBLISHED" ? (
                      <Badge variant="success">上架</Badge>
                    ) : (
                      <Badge variant="default">{p.status}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`/cms/products/${p.id}`}
                        className="text-rose-600 hover:underline"
                      >
                        编辑
                      </Link>
                      <button
                        type="button"
                        onClick={() => setConfirmTarget(p)}
                        disabled={deletingId === p.id}
                        className="text-red-600 hover:text-red-900 disabled:opacity-50"
                      >
                        {deletingId === p.id ? "删除中…" : "删除"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
