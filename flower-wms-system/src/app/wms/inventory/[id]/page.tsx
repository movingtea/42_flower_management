import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import {
  mockBatchHistory,
  mockFifoFlow,
  mockProductDetail,
} from "@/lib/mock/inventory-detail";

export default async function InventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = mockProductDetail(id);

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
          SKU {product.sku} · 合计 {product.totalQty} {product.unit} · 安全库存{" "}
          {product.safetyThreshold}
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
                <th className="px-4 py-3">保质期</th>
                <th className="px-4 py-3">库位</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {mockBatchHistory.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-medium">{b.batchNo}</td>
                  <td className="px-4 py-3 text-zinc-600">
                    {new Date(b.inboundAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-3">
                    {b.originalQty} / {b.remainingQty}
                  </td>
                  <td className="px-4 py-3">{b.expiresAt}</td>
                  <td className="px-4 py-3">{b.storageLocation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-semibold text-zinc-900">FIFO 流向</h3>
        <ul className="space-y-3">
          {mockFifoFlow.map((flow, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 shadow-sm"
            >
              <div>
                <p className="font-medium text-zinc-900">{flow.ref}</p>
                <p className="text-sm text-zinc-500">
                  批次 {flow.batchNo} · {flow.at}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    flow.type === "INBOUND"
                      ? "success"
                      : flow.type === "WASTAGE_OUT"
                        ? "danger"
                        : "info"
                  }
                >
                  {flow.type}
                </Badge>
                <span className="font-medium">{flow.qty}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
