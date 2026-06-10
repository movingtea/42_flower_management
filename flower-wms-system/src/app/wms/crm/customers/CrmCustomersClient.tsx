"use client";

import { useCallback, useEffect, useState } from "react";
import { ActionEmptyState } from "@/components/admin/ActionEmptyState";
import { CustomerTable } from "@/app/wms/crm/components/CustomerTable";
import { getCustomerSourceLabel } from "@/lib/crm-tags";
import { CustomerSource } from "@/generated/prisma/enums";

type ApiData = {
  customers: Array<{
    id: string;
    name: string;
    phone?: string | null;
    source: string;
    totalOrders: number;
    totalSpent: number;
    averageOrderValue: number;
    lastOrderAt?: string | null;
    recipientCount?: number;
    pendingReminderCount?: number;
    tags?: string[];
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

const SOURCE_OPTIONS = Object.values(CustomerSource);

export function CrmCustomersClient() {
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState("");
  const [minOrders, setMinOrders] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (source) params.set("source", source);
      if (minOrders) params.set("minOrders", minOrders);

      const res = await fetch(`/api/admin/crm/customers?${params}`);
      const json = (await res.json()) as {
        success: boolean;
        data?: ApiData;
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "客户列表加载失败，请稍后重试。");
      }
      setData(json.data);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "客户列表加载失败，请稍后重试。"
      );
    } finally {
      setLoading(false);
    }
  }, [keyword, source, minOrders, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-zinc-900">客户列表</h2>
        <p className="mt-2 text-sm text-zinc-500">
          小程序订单创建后自动沉淀客户档案，支持按来源与消费筛选。
        </p>
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          placeholder="搜索客户名 / 手机号"
          value={keyword}
          onChange={(e) => {
            setPage(1);
            setKeyword(e.target.value);
          }}
        />
        <select
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          value={source}
          onChange={(e) => {
            setPage(1);
            setSource(e.target.value);
          }}
        >
          <option value="">全部来源</option>
          {SOURCE_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {getCustomerSourceLabel(item)}
            </option>
          ))}
        </select>
        <input
          className="w-32 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          placeholder="最少订单数"
          value={minOrders}
          onChange={(e) => {
            setPage(1);
            setMinOrders(e.target.value.replace(/\D/g, ""));
          }}
        />
        <button
          type="button"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white"
          onClick={() => void load()}
        >
          查询
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500">
          正在加载客户列表…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
          {error}
        </div>
      ) : (
        <>
          {(data?.customers ?? []).length === 0 ? (
            <ActionEmptyState
              title="暂无客户数据"
              description="小程序订单创建后会自动沉淀客户和收花人。"
              primaryActionLabel="查看小程序订单"
              primaryActionHref="/wms/orders"
            />
          ) : (
            <CustomerTable rows={data?.customers ?? []} />
          )}
          {data && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-zinc-600">
              <span>
                第 {data.pagination.page} / {data.pagination.totalPages} 页，共{" "}
                {data.pagination.total} 位客户
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  className="rounded border px-3 py-1 disabled:opacity-40"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={page >= data.pagination.totalPages}
                  className="rounded border px-3 py-1 disabled:opacity-40"
                  onClick={() =>
                    setPage((p) => Math.min(data.pagination.totalPages, p + 1))
                  }
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
