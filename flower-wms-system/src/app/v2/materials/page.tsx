import { MaterialMasterPage, type MaterialSearchParams } from "./_components/MaterialMasterPage";
import { FLOWER_SCOPE } from "./_components/material-scope";

export const dynamic = "force-dynamic";

/** 花材母表: only FLOWER / FOLIAGE materials. Consumables live at `/v2/consumables`. */
export default function MaterialsPage({ searchParams }: { searchParams: Promise<MaterialSearchParams> }) {
  return <MaterialMasterPage scope={FLOWER_SCOPE} searchParams={searchParams} />;
}
