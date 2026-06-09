"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format-money";
import {
  allocationMethodLabels,
  formatDate,
  formatDateTime,
  formatQuantity,
  isEditablePurchaseStatus,
  purchaseStatusLabels,
  type PurchaseOrderDetail,
} from "@/app/wms/purchase-orders/types";

type Props = {
  order: PurchaseOrderDetail;
  onClose: () => void;
  onEdit: () => void;
  onCancelOrder: () => void;
  onReceive: () => void;
  onUpdateStandardCosts: () => void;
  busy?: boolean;
};

function statusVariant(status: PurchaseOrderDetail["status"]) {
  if (status === "ORDERED") return "info";
  if (status === "RECEIVED") return "success";
  if (status === "CANCELLED") return "danger";
  return "default";
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-zinc-800">{value || "—"}</dd>
    </div>
  );
}

export function PurchaseOrderDetailModal({
  order,
  onClose,
  onEdit,
  onCancelOrder,
  onReceive,
  onUpdateStandardCosts,
  busy = false,
}: Props) {
  const actionable = isEditablePurchaseStatus(order.status);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-100 px-6 py-5">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-semibold text-zinc-900">
                {order.purchaseNo}
              </h3>
              <Badge variant={statusVariant(order.status)}>
                {purchaseStatusLabels[order.status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {order.supplier.name} · {formatDate(order.purchaseDate)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-2xl leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="max-h-[calc(90vh-92px)] overflow-y-auto px-6 py-5">
          <section className="grid gap-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 md:grid-cols-4">
            <InfoItem label="供应商" value={order.supplier.name} />
            <InfoItem label="状态" value={purchaseStatusLabels[order.status]} />
            <InfoItem label="采购日期" value={formatDate(order.purchaseDate)} />
            <InfoItem
              label="预计到货"
              value={formatDate(order.expectedArrivalDate)}
            />
            <InfoItem label="到货时间" value={formatDateTime(order.receivedAt)} />
            <InfoItem label="联系人" value={order.supplier.contactName ?? "—"} />
            <InfoItem label="电话" value={order.supplier.phone ?? "—"} />
            <InfoItem label="备注" value={order.note ?? "—"} />
          </section>

          <section className="mt-5 grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm md:grid-cols-7">
            <InfoItem label="商品金额" value={formatCurrency(order.goodsAmount)} />
            <InfoItem label="运费" value={formatCurrency(order.shippingFee)} />
            <InfoItem label="包装费" value={formatCurrency(order.packagingFee)} />
            <InfoItem label="其他费用" value={formatCurrency(order.otherFee)} />
            <InfoItem
              label="附加费用"
              value={formatCurrency(order.totalExtraFee)}
            />
            <InfoItem
              label="总金额"
              value={
                <span className="font-semibold text-rose-700">
                  {formatCurrency(order.totalAmount)}
                </span>
              }
            />
            <InfoItem
              label="分摊方式"
              value={allocationMethodLabels[order.allocationMethod]}
            />
          </section>

          <section className="mt-5 overflow-x-auto rounded-xl border border-zinc-200">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="border-b bg-zinc-50 text-xs text-zinc-600">
                <tr>
                  <th className="px-3 py-3 font-medium">花材</th>
                  <th className="px-3 py-3 font-medium">采购名称</th>
                  <th className="px-3 py-3 font-medium">等级</th>
                  <th className="px-3 py-3 font-medium">颜色</th>
                  <th className="px-3 py-3 font-medium">规格</th>
                  <th className="px-3 py-3 font-medium">数量</th>
                  <th className="px-3 py-3 font-medium">单位</th>
                  <th className="px-3 py-3 font-medium">折算支数</th>
                  <th className="px-3 py-3 font-medium">总支数</th>
                  <th className="px-3 py-3 font-medium">单价</th>
                  <th className="px-3 py-3 font-medium">商品小计</th>
                  <th className="px-3 py-3 font-medium">分摊费用</th>
                  <th className="px-3 py-3 font-medium">实际总成本</th>
                  <th className="px-3 py-3 font-medium">单支成本</th>
                  <th className="px-3 py-3 font-medium">入库批次</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {order.lines.map((line) => (
                  <tr key={line.id} className="align-top hover:bg-zinc-50/70">
                    <td className="px-3 py-3 font-medium text-zinc-900">
                      {line.flowerWiki.chineseName}
                      <p className="text-xs font-normal text-zinc-500">
                        {line.flowerWiki.englishName}
                      </p>
                    </td>
                    <td className="px-3 py-3">{line.purchaseName || "—"}</td>
                    <td className="px-3 py-3">{line.grade || "—"}</td>
                    <td className="px-3 py-3">{line.color || "—"}</td>
                    <td className="px-3 py-3">{line.spec || "—"}</td>
                    <td className="px-3 py-3">
                      {formatQuantity(line.purchaseQuantity)}
                    </td>
                    <td className="px-3 py-3">{line.purchaseUnit}</td>
                    <td className="px-3 py-3">
                      {formatQuantity(line.stemsPerUnit)}
                    </td>
                    <td className="px-3 py-3">{formatQuantity(line.totalStems)}</td>
                    <td className="px-3 py-3">{formatCurrency(line.unitPrice)}</td>
                    <td className="px-3 py-3">
                      {formatCurrency(line.lineAmount)}
                    </td>
                    <td className="px-3 py-3">
                      {formatCurrency(line.allocatedExtraFee)}
                    </td>
                    <td className="px-3 py-3">
                      {formatCurrency(line.actualTotalCost)}
                    </td>
                    <td className="px-3 py-3">
                      ¥{Number(line.actualUnitCost).toFixed(4)}
                    </td>
                    <td className="px-3 py-3">
                      {line.inboundBatch ? (
                        <>
                          <span className="font-medium">
                            {line.inboundBatch.batchNo ?? line.inboundBatch.id}
                          </span>
                          <p className="text-xs text-zinc-500">
                            ID：{line.inboundBatch.id.slice(0, 8)}
                          </p>
                        </>
                      ) : (
                        line.inboundBatchId ?? "未入库"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onEdit} disabled={!actionable || busy}>
              编辑
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onCancelOrder}
              disabled={!actionable || busy}
              className="text-red-600"
            >
              取消采购单
            </Button>
            <Button type="button" onClick={onReceive} disabled={!actionable || busy}>
              到货入库
            </Button>
            {order.status === "RECEIVED" && (
              <Button
                type="button"
                variant="secondary"
                onClick={onUpdateStandardCosts}
                disabled={busy}
              >
                用本次采购价更新标准成本
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
