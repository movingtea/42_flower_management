import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { StockLogType } from "@/generated/prisma/enums";
import { formatDateTimeInAppTimezone } from "@/lib/datetime";
import { loadMaterialInventoryDetail } from "@/services/wms-inventory-detail";

function formatDateTime(value: string) {
  return formatDateTimeInAppTimezone(value);
}

export const dynamic = "force-dynamic";

function flowBadgeVariant(
  type: StockLogType
): "default" | "success" | "warning" | "info" | "danger" {
  switch (type) {
    case StockLogType.INBOUND:
      return "success";
    case StockLogType.WASTAGE_OUT:
      return "danger";
    case StockLogType.SALE_OUT:
      return "info";
    case StockLogType.ADJUSTMENT:
      return "warning";
    default:
      return "default";
  }
}

export default async function InventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await loadMaterialInventoryDetail(id);

  if (!product) {
    notFound();
  }

  return (
    <div>
      <Link
        href="/wms/inventory"
        className="text-sm text-rose-600 hover:underline"
      >
        ← 返回库存列表
      </Link>

      <header className="mb-8 mt-4">
        <h2 className="text-2xl font-semibold text-zinc-900">{product.name}</h2>
        <p className="mt-1 text-sm text-zinc-500">
          编码 {product.materialCode} · 合计 {product.totalQty} {product.unit}{" "}
          · 安全库存 {product.safetyThreshold} {product.unit}
        </p>
      </header>

      <section className="mb-8">
        <h3 className="mb-4 text-sm font-semibold text-zinc-900">历史批次</h3>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="px-4 py-3">批次号</th>
                <th className="px-4 py-3">入库时间</th>
                <th className="px-4 py-3">原始 / 剩余</th>
                <th className="px-4 py-3">瓶插期</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {product.batches.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    暂无批次记录
                  </td>
                </tr>
              ) : (
                product.batches.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 font-medium">{b.batchNo}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {formatDateTime(b.inboundAt)}
                    </td>
                    <td className="px-4 py-3">
                      {b.originalQty} / {b.remainingQty}
                    </td>
                    <td className="px-4 py-3">{b.expiresAt}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h3 className="mb-4 text-sm font-semibold text-zinc-900">
          📜 历史报损盘点日志
        </h3>
        {product.lossHistory.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500">
            暂无报损记录
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    报损时间
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    报损批次
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    损耗数量
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    损耗原因
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {product.lossHistory.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-zinc-600">{row.at}</td>
                    <td className="px-4 py-3 font-medium">{row.batchLabel}</td>
                    <td className="px-4 py-3 text-rose-700">
                      {row.lossQuantity} {product.unit}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-4 text-sm font-semibold text-zinc-900">
          库存流水
        </h3>
        <p className="mb-3 text-xs text-zinc-500">
          按时间倒序展示本原材料关联批次的出入库流水；销售出库的 FIFO 扣减见
          services/fifo.ts。
        </p>
        {product.fifoFlows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500">
            暂无库存流水
          </p>
        ) : (
          <ul className="space-y-3">
            {product.fifoFlows.map((flow, i) => (
              <li
                key={`${flow.batchNo}-${flow.at}-${i}`}
                className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 shadow-sm"
              >
                <div>
                  <p className="font-medium text-zinc-900">{flow.ref}</p>
                  <p className="text-sm text-zinc-500">
                    批次 {flow.batchNo} · {flow.at}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={flowBadgeVariant(flow.type)}>
                    {flow.typeLabel}
                  </Badge>
                  <span className="font-medium">{flow.qty}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
