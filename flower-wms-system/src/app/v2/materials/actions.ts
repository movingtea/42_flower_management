"use server";

import { redirect } from "next/navigation";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { createMaterialMaster, setMaterialActive, updateMaterialMaster } from "@/v2/services/master-data";
import { parseMaterialForm } from "./material-form";

function text(data: FormData, key: string) { const value = data.get(key); return typeof value === "string" ? value : ""; }
function materialInput(data: FormData) { return parseMaterialForm(data); }
async function run(operation: () => Promise<void>, success: string): Promise<never> { try { await operation(); redirect(`/v2/materials?message=${encodeURIComponent(success)}`); } catch (cause) { if (cause && typeof cause === "object" && "digest" in cause) throw cause; redirect(`/v2/materials?error=${encodeURIComponent(cause instanceof Error ? cause.message : "操作失败")}`); } }
export async function createMaterialAction(data: FormData) { return run(async () => { const scope = await requireV2Store("catalog"); await v2db.$transaction((tx) => createMaterialMaster(tx, { ...scope, actorStaffId: scope.staffId }, materialInput(data))); }, "物料已创建"); }
export async function updateMaterialAction(data: FormData) { return run(async () => { const scope = await requireV2Store("catalog"); await v2db.$transaction((tx) => updateMaterialMaster(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "materialId"), materialInput(data))); }, "物料已更新"); }
export async function setMaterialActiveAction(data: FormData) { const active = text(data, "active") === "true"; return run(async () => { const scope = await requireV2Store("catalog"); await v2db.$transaction((tx) => setMaterialActive(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "materialId"), active)); }, active ? "物料已启用" : "物料已停用"); }
