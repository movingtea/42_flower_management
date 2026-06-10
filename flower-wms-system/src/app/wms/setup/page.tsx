import { Suspense } from "react";
import { PageLoading } from "@/components/admin/PageState";
import { SetupWizardClient } from "./SetupWizardClient";

export const dynamic = "force-dynamic";

export default function WmsSetupPage() {
  return (
    <Suspense fallback={<PageLoading text="正在加载试运营准备…" />}>
      <SetupWizardClient />
    </Suspense>
  );
}
