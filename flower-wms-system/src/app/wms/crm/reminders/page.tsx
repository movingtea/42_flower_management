import { Suspense } from "react";
import { CrmRemindersClient } from "./CrmRemindersClient";

export const dynamic = "force-dynamic";

export default function WmsCrmRemindersPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 shadow-sm">
          正在加载复购提醒…
        </div>
      }
    >
      <CrmRemindersClient />
    </Suspense>
  );
}
