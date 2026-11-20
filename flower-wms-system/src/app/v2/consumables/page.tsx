import { MaterialMasterPage, type MaterialSearchParams } from "../materials/_components/MaterialMasterPage";
import { CONSUMABLE_SCOPE } from "../materials/_components/material-scope";

export const dynamic = "force-dynamic";

/** 耗材母表: PACKAGING / CONSUMABLE / OTHER materials. Flowers live at `/v2/materials`. */
export default function ConsumablesPage({ searchParams }: { searchParams: Promise<MaterialSearchParams> }) {
  return <MaterialMasterPage scope={CONSUMABLE_SCOPE} searchParams={searchParams} />;
}
