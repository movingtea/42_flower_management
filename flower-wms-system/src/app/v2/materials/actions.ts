"use server";

import { redirect } from "next/navigation";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  createMaterialMaster,
  deleteMaterial,
  setMaterialActive,
  updateMaterialMaster,
  updateMaterialStandardCost,
} from "@/v2/services/master-data";
import { DEFAULT_MATERIAL_RETURN_TO, isMaterialReturnTo } from "./_components/material-scope";
import { parseMaterialForm } from "./material-form";
import { runV2DrawerAction } from "../_lib/action-result";

function text(data: FormData, key: string) { const value = data.get(key); return typeof value === "string" ? value : ""; }
function materialInput(data: FormData) { return parseMaterialForm(data); }

/**
 * Both the flower and consumable masters reuse these actions. The redirect
 * target comes from the hidden `returnTo` field, restricted to the allow-list in
 * `material-scope.ts`, so a crafted form can never redirect off-module.
 */
function resolveReturnTo(data: FormData) {
  const value = text(data, "returnTo").trim();
  return isMaterialReturnTo(value) ? value : DEFAULT_MATERIAL_RETURN_TO;
}

async function run(data: FormData, operation: () => Promise<string | void>, success: string): Promise<never> {
  const base = resolveReturnTo(data);
  let message = success;
  try {
    message = (await operation()) ?? success;
  } catch (cause) {
    if (cause && typeof cause === "object" && "digest" in cause) throw cause;
    return redirect(`${base}?error=${encodeURIComponent(cause instanceof Error ? cause.message : "操作失败")}`);
  }
  return redirect(`${base}?message=${encodeURIComponent(message)}`);
}

export async function createMaterialAction(data: FormData) { return runV2DrawerAction(async () => { const scope = await requireV2Store("catalog"); const material = await v2db.$transaction((tx) => createMaterialMaster(tx, { ...scope, actorStaffId: scope.staffId }, materialInput(data))); return `物料已创建，编号 ${material.code}`; }, "物料已创建"); }
export async function updateMaterialAction(data: FormData) { return runV2DrawerAction(async () => { const scope = await requireV2Store("catalog"); await v2db.$transaction((tx) => updateMaterialMaster(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "materialId"), materialInput(data))); }, "物料已更新"); }
export async function setMaterialActiveAction(data: FormData) { const active = text(data, "active") === "true"; return run(data, async () => { const scope = await requireV2Store("catalog"); await v2db.$transaction((tx) => setMaterialActive(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "materialId"), active)); }, active ? "物料已启用" : "物料已停用"); }
/** Row-inline standard cost edit: catalog capability, audited, timestamped. */
export async function updateMaterialStandardCostAction(data: FormData) { return run(data, async () => { const scope = await requireV2Store("catalog"); const material = await v2db.$transaction((tx) => updateMaterialStandardCost(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "materialId"), text(data, "standardUnitCost"))); return `已更新标准成本：${material.name} ¥${Number(material.standardUnitCost ?? 0).toFixed(2)}`; }, "标准成本已更新"); }
/** Delete is only allowed while the material has no business references. */
export async function deleteMaterialAction(data: FormData) { return run(data, async () => { const scope = await requireV2Store("catalog"); const material = await v2db.$transaction((tx) => deleteMaterial(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "materialId"))); return `物料已删除：${material.code} ${material.name}`; }, "物料已删除"); }
