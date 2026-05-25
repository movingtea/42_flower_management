import { WmsStockConsole } from "@/app/wms/operations/WmsStockConsole";
import { listActiveBatchPipeline } from "@/services/wms-stock";

export const dynamic = "force-dynamic";

export default async function WmsOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string }>;
}) {
  const sp = await searchParams;
  const pipeline = await listActiveBatchPipeline();
  const defaultPanel = sp.panel === "loss" ? "loss" : "inbound";

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 md:mb-8">
        <h2 className="text-xl font-semibold text-zinc-900 md:text-2xl">
          仓储日常操作
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          原料到货入库与大仓物理报损盘点；报损须手动指定批次，销售出库才走 FIFO 自动扣减。
        </p>
      </header>

      <WmsStockConsole
        initialPipeline={pipeline}
        defaultPanel={defaultPanel}
      />
    </div>
  );
}
