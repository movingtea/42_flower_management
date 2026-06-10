"use client";

import { useCallback, useEffect, useState } from "react";
import { ReminderTable } from "@/app/wms/crm/components/ReminderTable";
import {
  getReminderStatusLabel,
  getReminderTypeLabel,
} from "@/lib/crm-tags";
import { getTodayAppDateString, addAppCalendarDays, parseAppDateString } from "@/lib/datetime";
import { ReminderStatus, ReminderType } from "@/generated/prisma/enums";

type ApiData = {
  reminders: Array<{
    id: string;
    title: string;
    content?: string | null;
    customerId: string;
    customerName?: string | null;
    recipientName?: string | null;
    type: string;
    status: string;
    remindAtLabel?: string | null;
    dueDateLabel?: string | null;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function defaultEndDate(): string {
  const today = parseAppDateString(getTodayAppDateString())!;
  const end = addAppCalendarDays(today, 7);
  return `${end.year}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}`;
}

export function CrmRemindersClient() {
  const [status, setStatus] = useState("PENDING");
  const [startDate, setStartDate] = useState(getTodayAppDateString());
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [type, setType] = useState("");
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
        startDate,
        endDate,
      });
      if (status) params.set("status", status);
      if (type) params.set("type", type);

      const res = await fetch(`/api/admin/crm/reminders?${params}`);
      const json = (await res.json()) as {
        success: boolean;
        data?: ApiData;
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "提醒列表加载失败，请稍后重试。");
      }
      setData(json.data);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "提醒列表加载失败，请稍后重试。"
      );
    } finally {
      setLoading(false);
    }
  }, [status, startDate, endDate, type, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-zinc-900">复购提醒</h2>
        <p className="mt-2 text-sm text-zinc-500">
          提醒仅用于后台跟进，不会自动给客户发送微信、短信或订阅消息。
        </p>
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <select
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">全部状态</option>
          {Object.values(ReminderStatus).map((item) => (
            <option key={item} value={item}>
              {getReminderStatusLabel(item)}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          value={type}
          onChange={(e) => {
            setPage(1);
            setType(e.target.value);
          }}
        >
          <option value="">全部类型</option>
          {Object.values(ReminderType).map((item) => (
            <option key={item} value={item}>
              {getReminderTypeLabel(item)}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          value={startDate}
          onChange={(e) => {
            setPage(1);
            setStartDate(e.target.value);
          }}
        />
        <input
          type="date"
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          value={endDate}
          onChange={(e) => {
            setPage(1);
            setEndDate(e.target.value);
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
          正在加载提醒列表…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
          {error}
        </div>
      ) : (
        <>
          <ReminderTable
            rows={data?.reminders ?? []}
            onUpdated={() => void load()}
          />
          {data && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-zinc-600">
              <span>
                第 {data.pagination.page} / {data.pagination.totalPages} 页，共{" "}
                {data.pagination.total} 条提醒
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
