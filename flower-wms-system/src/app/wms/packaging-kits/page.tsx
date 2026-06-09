import { PackagingKitManager } from "@/app/wms/packaging-kits/PackagingKitManager";
import { loadPackagingKits } from "@/lib/packaging-kit.server";

export const dynamic = "force-dynamic";

export default async function WmsPackagingKitsPage() {
  const list = await loadPackagingKits();
  return <PackagingKitManager initialList={list} />;
}
