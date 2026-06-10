"use client";

import { useCallback, useEffect, useState } from "react";
import { ProductOperationSummaryBadge } from "@/components/cms/ProductOperationSummaryBadge";
import type {
  PublishReadinessResult,
  PublishReadinessStatus,
} from "@/services/cms-product-validation-pure";

const STATUS_HEADLINES: Record<PublishReadinessStatus, string> = {
  READY: "商品信息完整，可以上架。",
  WARNING: "商品可以上架，但建议检查以下问题。",
  BLOCKED: "商品缺少关键内容，不建议上架。",
  INCOMPLETE: "商品信息不完整，建议补充后再上架。",
};

type ApiResponse = {
  success: boolean;
  data?: PublishReadinessResult;
  error?: string;
};

type Props = {
  productId: string;
  refreshKey?: number;
};

export function ProductPublishReadinessPanel({ productId, refreshKey = 0 }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PublishReadinessResult | null>(null);

  const load = useCallback(async () => {
    if (!productId || productId === "new") return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/cms/products/${productId}/publish-readiness`
      );
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "商品运营数据加载失败，请稍后重试。");
      }
      setResult(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (productId === "new") {
    return (
      <p className="text-sm text-zinc-500">保存商品后可查看上架校验结果。</p>
    );
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">正在加载上架校验…</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
        {error}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-3 text-red-800 underline"
        >
          重试
        </button>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ProductOperationSummaryBadge
          status={result.overallStatus}
          score={result.score}
          canPromote={result.canPromote}
        />
        <div className="text-sm text-zinc-600">
          <p>商品运营完整度：{result.score} 分</p>
          <p className="mt-1">
            可上架：{result.canPublish ? "是" : "否"} · 适合主推：
            {result.canPromote ? "是" : "否"}
          </p>
        </div>
      </div>

      <p className="text-sm text-zinc-700">
        {STATUS_HEADLINES[result.overallStatus]}
      </p>

      <p className="text-xs text-zinc-500">
        上架校验只作为运营提示，不会自动改变商品上下架状态。
      </p>

      {result.blockingIssues.length > 0 ? (
        <IssueGroup
          title="阻塞项"
          items={result.blockingIssues}
          tone="danger"
        />
      ) : null}

      {result.warnings.length > 0 ? (
        <IssueGroup title="提醒" items={result.warnings} tone="warning" />
      ) : null}

      {result.suggestions.length > 0 ? (
        <IssueGroup title="建议" items={result.suggestions} tone="info" />
      ) : null}

      {result.checks.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-medium text-zinc-800">检查清单</p>
          <ul className="space-y-1 text-sm">
            {result.checks.map((check) => (
              <li key={check.key} className="flex items-start gap-2">
                <span
                  className={
                    check.passed ? "text-emerald-600" : "text-amber-600"
                  }
                >
                  {check.passed ? "✓" : "○"}
                </span>
                <span className="text-zinc-700">
                  {check.label}
                  {check.message ? ` — ${check.message}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function IssueGroup({
  title,
  items,
  tone,
}: {
  title: string;
  items: Array<{ message: string }>;
  tone: "danger" | "warning" | "info";
}) {
  const styles = {
    danger: "border-red-100 bg-red-50 text-red-800",
    warning: "border-amber-100 bg-amber-50 text-amber-900",
    info: "border-sky-100 bg-sky-50 text-sky-900",
  }[tone];

  return (
    <div className={`rounded-lg border p-3 ${styles}`}>
      <p className="mb-2 text-sm font-medium">{title}</p>
      <ul className="space-y-1 text-sm">
        {items.map((item, i) => (
          <li key={i}>· {item.message}</li>
        ))}
      </ul>
    </div>
  );
}
