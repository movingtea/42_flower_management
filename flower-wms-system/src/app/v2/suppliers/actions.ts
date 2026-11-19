"use server";
import { redirect } from "next/navigation";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { createSupplierMaster, setSupplierActive, updateSupplierMaster } from "@/v2/services/master-data";
function text(data: FormData, key: string) { const value = data.get(key); return typeof value === "string" ? value : ""; }
function supplierInput(data: FormData) { return { code: text(data, "code"), name: text(data, "name"), contactName: text(data, "contactName"), phone: text(data, "phone"), wechat: text(data, "wechat"), notes: text(data, "notes") }; }
async function run(operation: () => Promise<string | void>, success: string): Promise<never> { let message = success; try { message = (await operation()) ?? success; } catch (cause) { if (cause && typeof cause === "object" && "digest" in cause) throw cause; return redirect(`/v2/suppliers?error=${encodeURIComponent(cause instanceof Error ? cause.message : "操作失败")}`); } return redirect(`/v2/suppliers?message=${encodeURIComponent(message)}`); }
export async function createSupplierAction(data: FormData) { return run(async () => { const scope = await requireV2Store("purchase"); const supplier = await v2db.$transaction((tx) => createSupplierMaster(tx, { ...scope, actorStaffId: scope.staffId }, supplierInput(data))); return `供应商已创建，编号 ${supplier.code}`; }, "供应商已创建"); }
export async function updateSupplierAction(data: FormData) { return run(async () => { const scope = await requireV2Store("purchase"); await v2db.$transaction((tx) => updateSupplierMaster(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "supplierId"), supplierInput(data))); }, "供应商已更新"); }
export async function setSupplierActiveAction(data: FormData) { const active = text(data, "active") === "true"; return run(async () => { const scope = await requireV2Store("purchase"); await v2db.$transaction((tx) => setSupplierActive(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "supplierId"), active)); }, active ? "供应商已启用" : "供应商已停用"); }
