"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { WastageForm } from "./WastageForm";
import type { WastageBatchRow } from "./types";

function formatExpiry(iso: string | null) {
  if (!iso) return "??????";
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  batches: WastageBatchRow[];
};

export function WastageWorkspace({ batches }: Props) {
  const [selected, setSelected] = useState<WastageBatchRow | null>(null);

  return (
    <div className="grid gap-8 lg:grid-cols-5">
      <section className="lg:col-span-3">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900">
            即将过期批次
          </h3>
          <span className="text-xs text-zinc-500">{batches.length} 即将过期批次</span>
        </div>

        {batches.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-12 text-center text-sm text-zinc-500">
            暂无即将过期批次
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-rose-100 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-rose-50 bg-rose-50/60">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">品名</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">批次号</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">剩余数量</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">到期时间</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rose-50">
                  {batches.map((row) => {
                  const isSelected = selected?.id === row.id;
                  return (
                    <tr
                      key={row.id}
                      className={
                        isSelected
                          ? "bg-rose-50"
                          : row.isExpiringSoon
                            ? "bg-amber-50/70"
                            : "hover:bg-zinc-50/50"
                      }
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-zinc-900">
                          {row.productName}
                        </p>
                        {row.isExpiringSoon && (
                          <Badge variant="warning">3 即将过期</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {row.batchNo ?? "未知批次号"}
                      </td>
                      <td className="px-4 py-3 font-medium text-rose-700">
                        {row.remainingQty} {row.productUnit}
                      </td>
                      <td
                        className={`px-4 py-3 ${row.isExpiringSoon ? "font-medium text-amber-800" : "text-zinc-600"}`}
                      >
                        {formatExpiry(row.expiresAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          type="button"
                          variant={isSelected ? "primary" : "secondary"}
                          className="text-xs"
                          onClick={() => setSelected(row)}
                        >
                          {isSelected ? "取消" : "选择"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="lg:col-span-2">
        <WastageForm
          selected={selected}
          onClearSelection={() => setSelected(null)}
        />
      </section>
    </div>
  );
}
