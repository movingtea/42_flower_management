"use server";

import { redirect } from "next/navigation";
import { SampleState } from "@/generated/prisma-v2/client";
import { requireV2Store, type V2Capability } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  copySample,
  saveSample,
  setSampleState,
  type SampleMaterialInput,
} from "@/v2/services/sample-management";
import { confirmSampleMaterialSubstitution } from "@/v2/services/sample-substitution";
import {
  convertSampleToSku,
  convertSamplesToProduct,
  type SampleConversionLineInput,
} from "@/v2/services/sample-conversion";
import { runV2DrawerAction } from "../_lib/action-result";

type ActionScope = {
  tenantId: string;
  storeId: string;
  staffId: string;
  actorStaffId: string;
};

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(data: FormData, key: string, label: string): string {
  const value = text(data, key);
  if (!value) throw new Error(`${label}必填`);
  return value;
}

function optionalNumber(data: FormData, key: string, label: string): number | null {
  const raw = text(data, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label}必须为数字`);
  return value;
}

function optionalMarginPercent(data: FormData, key: string): number | null {
  const value = optionalNumber(data, key, "目标毛利率");
  if (value === null) return null;
  if (value < 0 || value >= 100) throw new Error("目标毛利率必须大于等于 0 且小于 100");
  return Math.round((value / 100 + Number.EPSILON) * 10_000) / 10_000;
}

function parseJsonArray<T>(data: FormData, key: string, label: string): T[] {
  const raw = text(data, key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not array");
    return parsed as T[];
  } catch {
    throw new Error(`${label}格式无效`);
  }
}

function parseSampleState(value: string): SampleState {
  if (!Object.values(SampleState).includes(value as SampleState)) {
    throw new Error("样品状态无效");
  }
  return value as SampleState;
}

function isNextRedirect(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "digest" in cause;
}

/**
 * Runs a capability check and mutation inside the same redirect boundary, so a
 * denied role gets the module's error banner instead of an unhandled server
 * error. The capability is still checked by requireV2Store on the server.
 */
async function authorized(
  capability: V2Capability,
  operation: (scope: ActionScope) => Promise<string>,
): Promise<never> {
  try {
    const scope = await requireV2Store(capability);
    const message = await operation({ ...scope, actorStaffId: scope.staffId });
    redirect(`/v2/samples?message=${encodeURIComponent(message)}`);
  } catch (cause) {
    if (isNextRedirect(cause)) throw cause;
    redirect(`/v2/samples?error=${encodeURIComponent(cause instanceof Error ? cause.message : "操作失败")}`);
  }
}

/**
 * Drawer form entries return their outcome instead of redirecting, so a failed
 * submit keeps the drawer (and the user's input) open with an inline error.
 */
async function authorizedResult(
  capability: V2Capability,
  operation: (scope: ActionScope) => Promise<string>,
) {
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store(capability);
    return operation({ ...scope, actorStaffId: scope.staffId });
  }, "操作成功");
}

function optionalDate(data: FormData, key: string, label: string): Date | null {
  const raw = text(data, key);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}无效`);
  return parsed;
}

export async function createSampleAction(data: FormData) {
  return authorizedResult("catalog", async (scope) => {
    const materials = parseJsonArray<SampleMaterialInput>(data, "materialsJson", "样品物料");
    const result = await v2db.$transaction((tx) =>
      saveSample(tx, scope, {
        name: requiredText(data, "name", "样品名称"),
        description: text(data, "description") || null,
        priority: Number(text(data, "priority") || 0),
        state: parseSampleState(text(data, "state") || "DRAFT"),
        targetMarginRate: optionalMarginPercent(data, "targetMarginPercent"),
        photoDueAt: optionalDate(data, "photoDueAt", "拍摄截止时间"),
        retentionUntil: optionalDate(data, "retentionUntil", "留样截止时间"),
        imageKey: text(data, "imageKey") || null,
        materials,
      })
    );
    return `样品 ${result.code} 已创建（v${result.versionNo}）`;
  });
}

export async function updateSampleAction(data: FormData) {
  return authorizedResult("catalog", async (scope) => {
    const sampleId = requiredText(data, "sampleId", "样品标识");
    const materials = parseJsonArray<SampleMaterialInput>(data, "materialsJson", "样品物料");
    const result = await v2db.$transaction((tx) =>
      saveSample(tx, scope, {
        id: sampleId,
        name: requiredText(data, "name", "样品名称"),
        description: text(data, "description") || null,
        priority: Number(text(data, "priority") || 0),
        state: parseSampleState(text(data, "state") || "DRAFT"),
        targetMarginRate: optionalMarginPercent(data, "targetMarginPercent"),
        photoDueAt: optionalDate(data, "photoDueAt", "拍摄截止时间"),
        retentionUntil: optionalDate(data, "retentionUntil", "留样截止时间"),
        imageKey: text(data, "imageKey") || null,
        materials,
      })
    );
    return `样品 ${result.code} 已保存（v${result.versionNo}）`;
  });
}

export async function copySampleAction(data: FormData) {
  return authorized("catalog", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      copySample(tx, scope, requiredText(data, "sampleId", "样品标识"))
    );
    return `样品已复制为 ${result.code}`;
  });
}

export async function setSampleStateAction(data: FormData) {  return authorized("catalog", async (scope) => {
    const state = parseSampleState(requiredText(data, "state", "样品状态"));
    const result = await v2db.$transaction((tx) =>
      setSampleState(tx, scope, requiredText(data, "sampleId", "样品标识"), state)
    );
    return `样品 ${result.code} 已更新为 ${state}`;
  });
}

export async function substituteSampleMaterialAction(data: FormData) {
  return authorized("catalog", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      confirmSampleMaterialSubstitution(tx, scope, {
        sampleId: requiredText(data, "sampleId", "样品标识"),
        fromMaterialId: requiredText(data, "fromMaterialId", "原物料"),
        toMaterialId: requiredText(data, "toMaterialId", "替代物料"),
        quantity: optionalNumber(data, "quantity", "换料数量") ?? undefined,
        reason: text(data, "reason") || null,
        confirmed: data.get("confirmed") !== null,
      })
    );
    return `已确认换料（${result.tier}），数量 ${result.quantity}${result.requiresRecalculation ? "；相关打样计划需要重新计算" : ""}`;
  });
}

export async function convertSampleAction(data: FormData) {
  return authorizedResult("catalog", async (scope) => {
    const lines = parseJsonArray<SampleConversionLineInput>(data, "linesJson", "SKU 配方");
    const result = await v2db.$transaction((tx) =>
      convertSampleToSku(tx, scope, {
        sampleId: requiredText(data, "sampleId", "样品标识"),
        productId: text(data, "productId") || null,
        newProductName: text(data, "newProductName") || null,
        skuName: requiredText(data, "skuName", "SKU 规格名称"),
        price: optionalNumber(data, "price", "SKU 售价"),
        targetMarginRate: optionalMarginPercent(data, "targetMarginPercent"),
        laborCost: optionalNumber(data, "laborCost", "人工成本") ?? 0,
        consumableCost: optionalNumber(data, "consumableCost", "耗材成本") ?? undefined,
        lines: lines.length > 0 ? lines : null,
      }), { timeout: 30_000 });
    return `已生成 SKU ${result.skuCode}，配方草稿 v1，请发布配方并启用 SKU`;
  });
}

export async function convertSamplesAction(data: FormData) {
  return authorizedResult("catalog", async (scope) => {
    const sampleIds = data.getAll("sampleIds")
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    const results = await v2db.$transaction((tx) =>
      convertSamplesToProduct(tx, scope, {
        sampleIds,
        productId: text(data, "productId") || null,
        newProductName: text(data, "newProductName") || null,
        skuNamePrefix: text(data, "skuNamePrefix") || null,
        price: optionalNumber(data, "price", "SKU 售价"),
        targetMarginRate: optionalMarginPercent(data, "targetMarginPercent"),
        laborCost: optionalNumber(data, "laborCost", "人工成本") ?? 0,
        consumableCost: optionalNumber(data, "consumableCost", "耗材成本") ?? undefined,
      }), { timeout: 30_000 });
    return `已生成 ${results.length} 个 SKU：${results.map((result) => result.skuCode).join("、")}`;
  });
}
