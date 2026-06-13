"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { formatCurrency, formatPercent } from "@/lib/format-money";
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
    <AdminDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={order.purchaseNo}
      description={`${order.supplier.name} · ${formatDate(order.purchaseDate)} · ${purchaseStatusLabels[order.status]}`}
      size="full"
      closeOnOverlayClick
      bodyClassName="space-y-4"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {order.status === "RECEIVED" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={onUpdateStandardCosts}
                disabled={busy}
              >
                更新标准成本
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={onCancelOrder}
              disabled={!actionable || busy}
              className="text-red-600"
            >
              取消采购单
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              关闭
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onEdit}
              disabled={!actionable || busy}
            >
              编辑
            </Button>
            <Button type="button" onClick={onReceive} disabled={!actionable || busy}>
              到货入库
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex items-center gap-2">
        <Badge variant={statusVariant(order.status)}>
          {purchaseStatusLabels[order.status]}
        </Badge>
      </div>

      <section className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 md:grid-cols-4">
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

      <section className="grid gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm md:grid-cols-4">
        <InfoItem label="商品金额" value={formatCurrency(order.goodsAmount)} />
        <InfoItem label="运费" value={formatCurrency(order.shippingFee)} />
        <InfoItem label="包装费" value={formatCurrency(order.packagingFee)} />
        <InfoItem label="其他费用" value={formatCurrency(order.otherFee)} />
        <InfoItem label="附加费用" value={formatCurrency(order.totalExtraFee)} />
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

      <section className="overflow-x-auto rounded-xl border border-zinc-200">
        <table className="w-full min-w-[1200px] text-left text-sm">
          <thead className="border-b bg-zinc-50 text-xs text-zinc-600">
            <tr>
              <th className="px-3 py-2 font-medium">花材</th>
              <th className="px-3 py-2 font-medium">采购名称</th>
              <th className="px-3 py-2 font-medium">等级</th>
              <th className="px-3 py-2 font-medium">颜色</th>
              <th className="px-3 py-2 font-medium">规格</th>
              <th className="px-3 py-2 font-medium">数量</th>
              <th className="px-3 py-2 font-medium">单位</th>
              <th className="px-3 py-2 font-medium">折算支数</th>
              <th className="px-3 py-2 font-medium">总支数</th>
              <th className="px-3 py-2 font-medium">单价</th>
              <th className="px-3 py-2 font-medium">商品小计</th>
              <th className="px-3 py-2 font-medium">分摊费用</th>
              <th className="px-3 py-2 font-medium">实际总成本</th>
              <th className="px-3 py-2 font-medium">实际单支成本</th>
              <th className="px-3 py-2 font-medium">可用率</th>
              <th className="px-3 py-2 font-medium">损耗率</th>
              <th className="px-3 py-2 font-medium">损耗后单支成本</th>
              <th className="px-3 py-2 font-medium">损耗增加成本</th>
              <th className="px-3 py-2 font-medium">入库批次</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {order.lines.map((line) => (
              <tr key={line.id} className="align-top hover:bg-zinc-50/70">
                <td className="px-3 py-2 font-medium text-zinc-900">
                  {line.flowerWiki.chineseName}
                  <p className="text-xs font-normal text-zinc-500">
                    {line.flowerWiki.englishName}
                  </p>
                </td>
                <td className="px-3 py-2">{line.purchaseName || "—"}</td>
                <td className="px-3 py-2">{line.grade || "—"}</td>
                <td className="px-3 py-2">{line.color || "—"}</td>
                <td className="px-3 py-2">{line.spec || "—"}</td>
                <td className="px-3 py-2">
                  {formatQuantity(line.purchaseQuantity)}
                </td>
                <td className="px-3 py-2">{line.purchaseUnit}</td>
                <td className="px-3 py-2">
                  {formatQuantity(line.stemsPerUnit)}
                </td>
                <td className="px-3 py-2">{formatQuantity(line.totalStems)}</td>
                <td className="px-3 py-2">{formatCurrency(line.unitPrice)}</td>
                <td className="px-3 py-2">{formatCurrency(line.lineAmount)}</td>
                <td className="px-3 py-2">
                  {formatCurrency(line.allocatedExtraFee)}
                </td>
                <td className="px-3 py-2">
                  {formatCurrency(line.actualTotalCost)}
                </td>
                <td className="px-3 py-2">
                  ¥{Number(line.actualUnitCost).toFixed(4)}
                </td>
                <td className="px-3 py-2">
                  {line.usableRate ? formatPercent(line.usableRate) : "—"}
                </td>
                <td className="px-3 py-2">
                  {line.lossRate ? formatPercent(line.lossRate) : "—"}
                </td>
                <td className="px-3 py-2">
                  {line.lossAdjustedUnitCost
                    ? `¥${Number(line.lossAdjustedUnitCost).toFixed(4)}`
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  {line.lossModelExtraCost
                    ? formatCurrency(line.lossModelExtraCost)
                    : "—"}
                </td>
                <td className="px-3 py-2">
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
    </AdminDrawer>
  );
}
