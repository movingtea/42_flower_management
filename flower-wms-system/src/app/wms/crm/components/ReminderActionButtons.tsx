"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  reminderId: string;
  onUpdated?: () => void;
};

export function ReminderActionButtons({ reminderId, onUpdated }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  async function patchStatus(
    status: "DONE" | "SNOOZED" | "CANCELLED",
    snoozedUntil?: string
  ) {
    setLoading(status);
    try {
      const res = await fetch(`/api/admin/crm/reminders/${reminderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, snoozedUntil }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "更新失败");
      }
      onUpdated?.();
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "更新提醒失败");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        className="px-3 py-1.5 text-xs"
        variant="secondary"
        disabled={!!loading}
        onClick={() => void patchStatus("DONE")}
      >
        {loading === "DONE" ? "处理中…" : "完成"}
      </Button>
      <Button
        type="button"
        className="px-3 py-1.5 text-xs"
        variant="secondary"
        disabled={!!loading}
        onClick={() => void patchStatus("SNOOZED")}
      >
        {loading === "SNOOZED" ? "处理中…" : "明天再提醒"}
      </Button>
      <Button
        type="button"
        className="px-3 py-1.5 text-xs"
        variant="ghost"
        disabled={!!loading}
        onClick={() => void patchStatus("CANCELLED")}
      >
        {loading === "CANCELLED" ? "处理中…" : "取消"}
      </Button>
    </div>
  );
}
