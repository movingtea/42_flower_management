"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QuantityStepper } from "@/components/shared/QuantityStepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MaterialCategoryRow } from "@/lib/material-category";

const READONLY_CODE_CLASS =
  "cursor-not-allowed bg-gray-100 text-gray-400";

type Props = {
  materialCategories: MaterialCategoryRow[];
};

export function InboundForm({ materialCategories }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    materialCategories[0]?.id ?? ""
  );
  const [receivedQty, setReceivedQty] = useState(1);
  const [safetyStockThreshold, setSafetyStockThreshold] = useState(20);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const name = String(fd.get("name") ?? "").trim();
    const costPrice = Number(fd.get("costPrice"));
    const expiryDate = String(fd.get("expiryDate") ?? "");
    const supplierName = String(fd.get("supplierName") ?? "").trim();

    if (!name) {
      alert("请填写花材名称");
      return;
    }
    if (!selectedCategoryId) {
      alert("请选择原材料分类");
      return;
    }
    if (!Number.isInteger(receivedQty) || receivedQty <= 0) {
      alert("入库数量必须为正整数");
      return;
    }
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      alert("进货单价无效");
      return;
    }
    if (
      !Number.isInteger(safetyStockThreshold) ||
      safetyStockThreshold < 0
    ) {
      alert("安全库存须为非负整数");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          materialCategoryIds: [selectedCategoryId],
          receivedQty,
          costPrice,
          safetyStockThreshold,
          expiryDate: expiryDate || undefined,
          supplierName: supplierName || undefined,
        }),
      });

      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: {
          batch?: { batchNo?: string };
          material?: { materialCode?: string };
          materialCreated?: boolean;
        };
      };

      if (!res.ok || !json.success) {
        alert(json.error ?? "入库失败，请稍后重试");
        return;
      }

      const batchNo = json.data?.batch?.batchNo ?? "";
      const code = json.data?.material?.materialCode;
      const created = json.data?.materialCreated;
      alert(
        batchNo
          ? created && code
            ? `入库成功！批次号：${batchNo}，新材料编码：${code}`
            : `入库成功！批次号：${batchNo}`
          : "入库成功"
      );
      form.reset();
      router.refresh();
    } catch {
      alert("网络异常，请检查连接后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-10 max-w-xl space-y-4 rounded-xl border bg-white p-6 shadow-sm"
    >
      <Input
        label="原材料编码"
        readOnly
        disabled
        placeholder="系统自动生成"
        className={READONLY_CODE_CLASS}
        value=""
        onChange={() => {}}
      />
      <Input
        name="name"
        label="花材名称"
        placeholder="昆明 A 级红玫瑰"
        required
      />

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">
          原材料分类
        </span>
        {materialCategories.length === 0 ? (
          <p className="text-sm text-amber-700">
            暂无原材料分类，请先在
            <a href="/wms/material-categories" className="mx-1 text-rose-600 underline">
              原材料分类管理
            </a>
            中创建。
          </p>
        ) : (
          <select
            required
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-zinc-900"
          >
            {materialCategories.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))}
          </select>
        )}
      </label>

      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-700">
          安全库存
        </label>
        <QuantityStepper
          value={safetyStockThreshold}
          min={0}
          onChange={setSafetyStockThreshold}
          disabled={submitting}
          aria-label="安全库存"
        />
        <p className="mt-1 text-xs text-zinc-500">
          当总库存低于此数值时，系统将触发低库存红色预警
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-700">
          入库数量
        </label>
        <QuantityStepper
          value={receivedQty}
          min={1}
          onChange={setReceivedQty}
          disabled={submitting}
          aria-label="入库数量"
        />
      </div>
      <Input
        name="costPrice"
        label="进货单价（元）"
        type="number"
        min={0}
        step={0.01}
        placeholder="2.50"
        required
      />
      <Input name="supplierName" label="供应商" placeholder="选填" />
      <Input name="expiryDate" label="瓶插期截止" type="date" />

      <Button type="submit" disabled={submitting || materialCategories.length === 0}>
        {submitting ? "提交中…" : "确认入库"}
      </Button>
    </form>
  );
}
