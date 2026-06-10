import { Suspense } from "react";
import { PageLoading } from "@/components/admin/PageState";
import { AuditLogsClient } from "./AuditLogsClient";

export const dynamic = "force-dynamic";

export default function WmsAuditLogsPage() {
  return (
    <Suspense fallback={<PageLoading text="正在加载操作日志…" />}>
      <AuditLogsClient />
    </Suspense>
  );
}
