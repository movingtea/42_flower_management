import { Suspense } from "react";
import { PageLoading } from "@/components/admin/PageState";
import { DataQualityClient } from "./DataQualityClient";

export const dynamic = "force-dynamic";

export default function WmsDataQualityPage() {
  return (
    <Suspense fallback={<PageLoading text="正在加载数据质量中心…" />}>
      <DataQualityClient />
    </Suspense>
  );
}
