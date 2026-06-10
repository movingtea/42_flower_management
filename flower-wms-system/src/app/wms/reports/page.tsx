import { Suspense } from "react";
import { BusinessReportsClient } from "./BusinessReportsClient";

export const dynamic = "force-dynamic";

export default function WmsReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 shadow-sm">
          正在加载经营报表...
        </div>
      }
    >
      <BusinessReportsClient />
    </Suspense>
  );
}
