import { AiInboundWorkspace } from "@/components/wms/AiInboundWorkspace";
import { InboundForm } from "@/app/wms/batches/InboundForm";
import { loadMaterialCategories } from "@/lib/material-category.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const materialCategories = await loadMaterialCategories({ activeOnly: true });

  const recentInbound = await prisma.batch.findMany({
    orderBy: { inboundAt: "desc" },
    take: 10,
    include: {
      material: { select: { name: true, unit: true } },
    },
  });

  return (
    <div>
      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-zinc-900">
          采购入库
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          填写 SKU、花材、数量与瓶插期，提交后写入商品、批次与入库流水
        </p>
      </header>

      <AiInboundWorkspace />

      <h3 className="mb-4 mt-10 text-sm font-semibold text-zinc-500">
        传统手工入库（备用）
      </h3>
      <InboundForm materialCategories={materialCategories} />

      <section>
        <h3 className="mb-4 text-sm font-semibold text-zinc-900">
          最近入库
        </h3>
        {recentInbound.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500">
            暂无入库记录，请提交第一次采购入库
          </p>
        ) : (
          <ul className="space-y-3">
            {recentInbound.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border bg-white px-4 py-3 shadow-sm"
              >
                <p className="font-medium">
                  {row.batchNo ?? "未知"} {"·"} {row.material.name} ·{" "}
                  {row.originalQty} {row.material.unit}
                </p>
                <p className="text-sm text-zinc-500">
                  {row.supplier ? `${row.supplier} · ` : ""}
                  {row.expiresAt
                    ? `瓶插期至 ${row.expiresAt.toLocaleDateString("zh-CN")} · `
                    : ""}
                  {row.inboundAt.toLocaleString("zh-CN")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
