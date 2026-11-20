"use server";

import { runV2DrawerAction } from "../_lib/action-result";
import {
  receivePurchaseFromForm,
  rejectPurchaseFromForm,
} from "@/v2/services/purchase-receipt";

/**
 * Drawer actions for the dedicated receiving page. They return explicit
 * outcomes so `V2DrawerForm` closes only on success, keeps the operator's input
 * on failure and refreshes the list without a page-level query redirect.
 */
export async function receivePurchaseAction(data: FormData) {
  return runV2DrawerAction(() => receivePurchaseFromForm(data), "验收入库完成");
}

export async function rejectPurchaseAction(data: FormData) {
  return runV2DrawerAction(() => rejectPurchaseFromForm(data), "拒收已记录，可用库存未增加");
}
