import { Suspense } from "react";
import { CrmOverviewClient } from "./CrmOverviewClient";

export const dynamic = "force-dynamic";

export default function WmsCrmPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 shadow-sm">
          正在加载客户 CRM…
        </div>
      }
    >
      <CrmOverviewClient />
    </Suspense>
  );
}
