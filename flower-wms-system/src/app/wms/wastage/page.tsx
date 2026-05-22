import { WastageWorkspace } from "@/app/wms/wastage/WastageWorkspace";
import type { WastageBatchRow } from "@/app/wms/wastage/types";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function isExpiringSoon(expiresAt: Date | null, now: number): boolean {
  if (!expiresAt) return false;
  const diff = expiresAt.getTime() - now;
  return diff >= 0 && diff < THREE_DAYS_MS;
}

export default async function WastagePage() {
  const now = Date.now();

  const batches = await prisma.batch.findMany({
    where: { remainingQty: { gt: 0 } },
    orderBy: { expiresAt: "asc" },
    include: {
      material: {
        select: { name: true, unit: true },
      },
    },
  });

  const rows: WastageBatchRow[] = batches.map((b) => ({
    id: b.id,
    batchNo: b.batchNo,
    remainingQty: b.remainingQty,
    expiresAt: b.expiresAt?.toISOString() ?? null,
    productName: b.material.name,
    productUnit: b.material.unit,
    isExpiringSoon: isExpiringSoon(b.expiresAt, now),
  }));

  return (
    <div>
      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-rose-900">损耗登记与核销</h2>
        <p className="mt-1 text-sm text-zinc-500">
          按瓶插期从近到远查看有货批次，选择后填写报损数量并提交核销
        </p>
      </header>

      <WastageWorkspace batches={rows} />
    </div>
  );
}
