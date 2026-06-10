import { Suspense } from "react";
import { PageLoading } from "@/components/admin/PageState";
import { SystemHealthClient } from "./SystemHealthClient";

export const dynamic = "force-dynamic";

export default function WmsSystemHealthPage() {
  return (
    <Suspense fallback={<PageLoading text="正在加载系统健康检查…" />}>
      <SystemHealthClient />
    </Suspense>
  );
}
