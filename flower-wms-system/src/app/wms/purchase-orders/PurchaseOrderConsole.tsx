"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format-money";
import { PurchaseOrderDetailModal } from "@/app/wms/purchase-orders/PurchaseOrderDetailModal";
import { PurchaseOrderEditor } from "@/app/wms/purchase-orders/PurchaseOrderEditor";
import {
  formatDate,
  formatDateTime,
  isEditablePurchaseStatus,
  purchaseStatusLabels,
  type PurchaseOrderDetail,
  type PurchaseOrderListItem,
  type PurchaseOrderStatus,
  type Supplier,
} from "@/app/wms/purchase-orders/types";

type ViewMode = "list" | "create" | "edit";

type ListResponse = {
  items: PurchaseOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
};

const statusOptions: Array<[PurchaseOrderStatus, string]> = [
  ["DRAFT", "草稿"],
  ["ORDERED", "已下单"],
  ["RECEIVED", "已到货"],
  ["CANCELLED", "已取消"],
];

function statusVariant(status: PurchaseOrderStatus) {
  if (status === "ORDERED") return "info";
  if (status === "RECEIVED") return "success";
  if (status === "CANCELLED") return "danger";
  return "default";
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
      >
        {children}
      </select>
    </label>
  );
}

export function PurchaseOrderConsole() {
  const [items, setItems] = useState<PurchaseOrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingOrder, setEditingOrder] = useState<PurchaseOrderDetail | null>(null);
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ pageSize: "50" });
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (supplierId) params.set("supplierId", supplierId);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    return params.toString();
  }, [endDate, q, startDate, status, supplierId]);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadSuppliers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/wms/suppliers");
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { items?: Supplier[] };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "加载供应商失败");
      }
      setSuppliers(json.data?.items ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "加载供应商失败", "error");
    }
  }, [showToast]);

  const loadList = useCallback(async (nextQuery = "") => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/wms/purchase-orders?${nextQuery}`);
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: ListResponse;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "加载采购单失败");
      }
      setItems(json.data.items);
      setTotal(json.data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载采购单失败");
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadDetail(id: string) {
    const res = await fetch(`/api/admin/wms/purchase-orders/${id}`);
    const json = (await res.json()) as {
      success?: boolean;
      error?: string;
      data?: { purchaseOrder?: PurchaseOrderDetail };
    };
    if (!res.ok || !json.success || !json.data?.purchaseOrder) {
      throw new Error(json.error ?? "加载采购单详情失败");
    }
    return json.data.purchaseOrder;
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSuppliers();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSuppliers]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadList(queryString);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadList, queryString]);

  function resetFilters() {
    setQ("");
    setStatus("");
    setSupplierId("");
    setStartDate("");
    setEndDate("");
  }

  async function openDetail(id: string) {
    setActionBusy(true);
    try {
      setDetail(await loadDetail(id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "加载采购单详情失败", "error");
    } finally {
      setActionBusy(false);
    }
  }

  async function startEdit(id: string) {
    setActionBusy(true);
    try {
      const order = await loadDetail(id);
      if (!isEditablePurchaseStatus(order.status)) {
        showToast("已到货或已取消采购单不能编辑", "error");
        return;
      }
      setEditingOrder(order);
      setViewMode("edit");
      setDetail(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "加载采购单详情失败", "error");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleCancelOrder(order: PurchaseOrderDetail | PurchaseOrderListItem) {
    if (!isEditablePurchaseStatus(order.status)) return;
    if (!window.confirm(`确定取消采购单「${order.purchaseNo}」？`)) return;
    setActionBusy(true);
    try {
      const res = await fetch(`/api/admin/wms/purchase-orders/${order.id}/cancel`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { message?: string; purchaseOrder?: PurchaseOrderDetail };
      };
      if (!res.ok || !json.success || !json.data?.purchaseOrder) {
        throw new Error(json.error ?? "取消采购单失败");
      }
      showToast(json.data.message ?? "采购单已取消", "success");
      setDetail(json.data.purchaseOrder);
      await loadList(queryString);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "取消采购单失败", "error");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleReceive(order: PurchaseOrderDetail | PurchaseOrderListItem) {
    if (!isEditablePurchaseStatus(order.status)) return;
    if (
      !window.confirm(
        "入库后将生成库存批次和 INBOUND 流水，采购单不可再修改。确认继续吗？"
      )
    ) {
      return;
    }
    setActionBusy(true);
    try {
      const res = await fetch(`/api/admin/wms/purchase-orders/${order.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { message?: string; purchaseOrder?: PurchaseOrderDetail };
      };
      if (!res.ok || !json.success || !json.data?.purchaseOrder) {
        throw new Error(json.error ?? "采购单入库失败");
      }
      showToast(json.data.message ?? "采购单已到货入库", "success");
      setDetail(json.data.purchaseOrder);
      await loadList(queryString);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "采购单入库失败", "error");
    } finally {
      setActionBusy(false);
    }
  }

  if (viewMode === "create" || viewMode === "edit") {
    return (
      <div className="relative">
        {toast && (
          <Toast message={toast.message} type={toast.type} />
        )}
        <PurchaseOrderEditor
          suppliers={suppliers}
          order={viewMode === "edit" ? editingOrder : null}
          showToast={showToast}
          onCancel={() => {
            setViewMode("list");
            setEditingOrder(null);
          }}
          onSaved={(order) => {
            setViewMode("list");
            setEditingOrder(null);
            setDetail(order);
            void loadList(queryString);
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative">
      {toast && <Toast message={toast.message} type={toast.type} />}

      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">采购单管理</h2>
          <p className="mt-1 text-sm text-zinc-500">
            创建采购单、预览附加费用分摊，并在到货后生成库存批次和 INBOUND 流水。
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditingOrder(null);
            setViewMode("create");
          }}
        >
          新建采购单
        </Button>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 p-4">
          <div className="grid gap-3 lg:grid-cols-6">
            <Input
              label="搜索"
              placeholder="采购单号 / 供应商 / 备注"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <SelectField label="状态" value={status} onChange={setStatus}>
              <option value="">全部状态</option>
              {statusOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <SelectField label="供应商" value={supplierId} onChange={setSupplierId}>
              <option value="">全部供应商</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                  {supplier.isActive ? "" : "（已停用）"}
                </option>
              ))}
            </SelectField>
            <Input
              label="开始日期"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="结束日期"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <div className="flex items-end">
              <Button
                type="button"
                variant="secondary"
                onClick={resetFilters}
                className="w-full"
              >
                清空筛选
              </Button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-zinc-500">
            <span>共 {total} 张采购单</span>
            {error && <span className="text-red-600">{error}</span>}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="px-4 py-3 font-medium text-zinc-600">采购单号</th>
                <th className="px-4 py-3 font-medium text-zinc-600">供应商</th>
                <th className="px-4 py-3 font-medium text-zinc-600">采购日期</th>
                <th className="px-4 py-3 font-medium text-zinc-600">状态</th>
                <th className="px-4 py-3 font-medium text-zinc-600">商品金额</th>
                <th className="px-4 py-3 font-medium text-zinc-600">运费</th>
                <th className="px-4 py-3 font-medium text-zinc-600">包装费</th>
                <th className="px-4 py-3 font-medium text-zinc-600">其他费用</th>
                <th className="px-4 py-3 font-medium text-zinc-600">总金额</th>
                <th className="px-4 py-3 font-medium text-zinc-600">明细数</th>
                <th className="px-4 py-3 font-medium text-zinc-600">到货时间</th>
                <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-zinc-500">
                    正在加载采购单…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-zinc-500">
                    暂无采购单，请先创建采购单。
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const actionable = isEditablePurchaseStatus(item.status);
                  return (
                    <tr key={item.id} className="hover:bg-zinc-50/80">
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        {item.purchaseNo}
                      </td>
                      <td className="px-4 py-3">{item.supplier.name}</td>
                      <td className="px-4 py-3">{formatDate(item.purchaseDate)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(item.status)}>
                          {purchaseStatusLabels[item.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(item.goodsAmount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(item.shippingFee ?? 0)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(item.packagingFee ?? 0)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(item.otherFee ?? 0)}
                      </td>
                      <td className="px-4 py-3 font-semibold text-rose-700">
                        {formatCurrency(item.totalAmount)}
                      </td>
                      <td className="px-4 py-3">{item.lineCount}</td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {formatDateTime(item.receivedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDetail(item.id)}
                          className="mr-3 text-rose-600 hover:underline"
                          disabled={actionBusy}
                        >
                          查看
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(item.id)}
                          disabled={!actionable || actionBusy}
                          className="mr-3 text-zinc-600 hover:text-rose-600 disabled:text-zinc-300"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelOrder(item)}
                          disabled={!actionable || actionBusy}
                          className="mr-3 text-zinc-500 hover:text-red-600 disabled:text-zinc-300"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReceive(item)}
                          disabled={!actionable || actionBusy}
                          className="text-zinc-500 hover:text-emerald-700 disabled:text-zinc-300"
                        >
                          入库
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detail && (
        <PurchaseOrderDetailModal
          order={detail}
          busy={actionBusy}
          onClose={() => setDetail(null)}
          onEdit={() => startEdit(detail.id)}
          onCancelOrder={() => handleCancelOrder(detail)}
          onReceive={() => handleReceive(detail)}
        />
      )}
    </div>
  );
}

function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <div
      role="status"
      className={`fixed right-6 top-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
        type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
      }`}
    >
      {message}
    </div>
  );
}
