import { Suspense } from "react";
import { CustomerDetailClient } from "./CustomerDetailClient";

export const dynamic = "force-dynamic";

export default async function WmsCrmCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 shadow-sm">
          正在加载客户详情…
        </div>
      }
    >
      <CustomerDetailClient customerId={id} />
    </Suspense>
  );
}
