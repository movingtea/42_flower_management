import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function formatDateTime(d: Date) {
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isExpiringSoon(expiresAt: Date | null, now: number): boolean {
  if (!expiresAt) return false;
  const diff = expiresAt.getTime() - now;
  return diff >= 0 && diff < THREE_DAYS_MS;
}

export default async function InventoryPage() {
  const now = Date.now();
  const updatedAt = new Date();

  const materials = await prisma.material.findMany({
    include: {
      batches: {
        orderBy: { inboundAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-zinc-900">
          库存管理
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          库存管理，用于展示仓库的库存情况。
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-100 bg-zinc-50">
            <tr>
              <th className="px-4 py-3 font-medium text-zinc-600">
                原材料名称
              </th>
              <th className="px-4 py-3 font-medium text-zinc-600">
                单位
              </th>
              <th className="px-4 py-3 font-medium text-zinc-600">
                库存数量
              </th>
              <th className="px-4 py-3 font-medium text-zinc-600">
                安全库存
              </th>
              <th className="px-4 py-3 font-medium text-zinc-600">
                存储位置
              </th>
              <th className="px-4 py-3 font-medium text-zinc-600">
                库存状态
              </th>
              <th className="px-4 py-3 font-medium text-zinc-600">
                即将过期批次
              </th>
              <th className="px-4 py-3 font-medium text-zinc-600">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {materials.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-zinc-500"
                >
                  暂无库存数据
                </td>
              </tr>
            ) : (
              materials.map((material) => {
                const totalQty = material.batches.reduce(
                  (sum, b) => sum + b.remainingQty,
                  0
                );
                const minStock = material.safetyStockThreshold;
                const isLowStock =
                  minStock > 0 ? totalQty < minStock : totalQty === 0;

                const activeBatches = material.batches.filter(
                  (b) => b.remainingQty > 0
                );
                const expiringBatches = activeBatches.filter((b) =>
                  isExpiringSoon(b.expiresAt, now)
                );
                const hasExpiring = expiringBatches.length > 0;

                const locations = [
                  ...new Set(
                    activeBatches
                      .map((b) => b.storageLocation)
                      .filter((loc): loc is string => Boolean(loc))
                  ),
                ];

                const rowTone = isLowStock
                  ? "bg-red-50 hover:bg-red-50/80"
                  : hasExpiring
                    ? "bg-amber-50/80 hover:bg-amber-50"
                    : "hover:bg-zinc-50/50";

                return (
                  <tr key={material.id} className={rowTone}>
                    <td className="px-4 py-3">
                      <p
                        className={`font-medium ${isLowStock ? "text-red-800" : "text-zinc-900"}`}
                      >
                        {material.name}
                      </p>
                      <p className="text-xs text-zinc-500">{material.materialCode}</p>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{material.unit}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          isLowStock
                            ? "text-lg font-bold text-red-600"
                            : hasExpiring
                              ? "font-semibold text-amber-700"
                              : ""
                        }
                      >
                        {totalQty} {material.unit}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {minStock} {material.unit}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {locations.length > 0
                        ? locations.join("\u3001")
                        : "暂无存储位置"}
                    </td>
                    <td className="px-4 py-3">
                      {isLowStock ? (
                        <Badge variant="danger">{"低库存"}</Badge>
                      ) : hasExpiring ? (
                        <Badge variant="warning">
                          {"即将过期" + expiringBatches.length}
                        </Badge>
                      ) : (
                        <Badge variant="success">{"正常库存"}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {expiringBatches.length === 0 ? (
                        <span className="text-zinc-400">{"暂无即将过期批次"}</span>
                      ) : (
                        <ul className="space-y-1">
                          {expiringBatches.map((b) => {
                            const daysLeft = b.expiresAt
                              ? Math.ceil(
                                  (b.expiresAt.getTime() - now) /
                                    (24 * 60 * 60 * 1000)
                                )
                              : 0;
                            return (
                              <li key={b.id}>
                                <span className="inline-flex flex-wrap items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                                  {b.batchNo ?? b.id.slice(0, 8)}
                                  {" \u00b7 剩余数量 "}
                                  {b.remainingQty}
                                  {material.unit}
                                  {" \u00b7 "}
                                  {daysLeft}
                                  {"? \u00b7 天 "}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/wms/inventory/${material.id}`}
                        className="text-rose-600 hover:underline"
                      >
                        {"库存详情 / FIFO"}
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-zinc-400">
        数据更新时间：{formatDateTime(updatedAt)} · 共 {materials.length} 种原材料
      </p>
    </div>
  );
}
