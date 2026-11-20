"use server";

import { redirect } from "next/navigation";
import { requireV2Store, type V2Capability } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  approvePlan,
  calculatePlan,
  cancelPlan,
  completeStep,
  copySamplePlan,
  pausePlan,
  recalculatePlan,
  resumePlan,
  saveSamplePlan,
  selectPlanRun,
  startNextStep,
  startPlan,
  type CancelSamplePlanInput,
  type SamplePlanItemInput,
  type SamplePlanStepActualInput,
} from "@/v2/services/sample-planning";
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

function isNextRedirect(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "digest" in cause;
}

async function authorized(
  capability: V2Capability,
  operation: (scope: ActionScope) => Promise<string>,
): Promise<never> {
  try {
    const scope = await requireV2Store(capability);
    const message = await operation({ ...scope, actorStaffId: scope.staffId });
    redirect(`/v2/sample-plans?message=${encodeURIComponent(message)}`);
  } catch (cause) {
    if (isNextRedirect(cause)) throw cause;
    redirect(`/v2/sample-plans?error=${encodeURIComponent(cause instanceof Error ? cause.message : "操作失败")}`);
  }
}

function transactionOptions() {
  return { timeout: 30_000 };
}

/** Drawer form entries return their outcome instead of redirecting. */
async function authorizedResult(
  capability: V2Capability,
  operation: (scope: ActionScope) => Promise<string>,
) {
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store(capability);
    return operation({ ...scope, actorStaffId: scope.staffId });
  }, "操作成功");
}

export async function createSamplePlanAction(data: FormData) {
  return authorizedResult("production", async (scope) => {
    const items = parseJsonArray<SamplePlanItemInput>(data, "itemsJson", "打样样品");
    const result = await v2db.$transaction((tx) =>
      saveSamplePlan(tx, scope, {
        name: requiredText(data, "name", "打样计划名称"),
        items,
      })
    );
    return `打样计划 ${result.name} 已创建，请计算方案`;
  });
}

export async function updateSamplePlanAction(data: FormData) {
  return authorizedResult("production", async (scope) => {
    const items = parseJsonArray<SamplePlanItemInput>(data, "itemsJson", "打样样品");
    const result = await v2db.$transaction((tx) =>
      saveSamplePlan(tx, scope, {
        id: requiredText(data, "planId", "打样计划标识"),
        name: requiredText(data, "name", "打样计划名称"),
        items,
      })
    );
    return `打样计划 ${result.name} 已保存`;
  });
}

export async function copySamplePlanAction(data: FormData) {
  return authorized("production", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      copySamplePlan(tx, scope, requiredText(data, "planId", "打样计划标识"))
    );
    return `打样计划已复制为 ${result.name}`;
  });
}

export async function calculateSamplePlanAction(data: FormData) {
  return authorized("production", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      calculatePlan(tx, scope, requiredText(data, "planId", "打样计划标识")),
      transactionOptions(),
    );
    const top = result.runs[0];
    return `已生成 ${result.runs.length} 个方案${top ? `，首选方案总成本 ¥${top.totalCost.toFixed(2)}，预计节省 ¥${top.estimatedSaving.toFixed(2)}` : ""}${result.warnings.length > 0 ? `；${result.warnings.join("；")}` : ""}`;
  });
}

export async function selectSamplePlanRunAction(data: FormData) {
  return authorized("production", async (scope) => {
    await v2db.$transaction((tx) =>
      selectPlanRun(
        tx,
        scope,
        requiredText(data, "planId", "打样计划标识"),
        requiredText(data, "runId", "方案标识"),
      )
    );
    return "已选择打样方案";
  });
}

export async function approveSamplePlanAction(data: FormData) {
  // Approval reserves real stock and is limited to catalog-capable managers/admins.
  return authorized("catalog", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      approvePlan(tx, scope, requiredText(data, "planId", "打样计划标识")),
      transactionOptions(),
    );
    return result.shortageQty > 0
      ? `计划已批准，首次制作仍缺料 ${result.shortageQty}，请补购或重新计算后再开始`
      : `计划已批准，首次制作已预留 ${result.reservedQty}`;
  });
}

export async function startSamplePlanAction(data: FormData) {
  return authorized("production", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      startPlan(tx, scope, requiredText(data, "planId", "打样计划标识")),
      transactionOptions(),
    );
    return `打样已开始，已领用 ${result.issuedQty} 到制作区`;
  });
}

export async function startNextSampleStepAction(data: FormData) {
  return authorized("production", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      startNextStep(tx, scope, requiredText(data, "planId", "打样计划标识")),
      transactionOptions(),
    );
    return `下一步已开始：复用 ${result.reusedQty}，新领用 ${result.issuedQty}`;
  });
}

export async function pauseSamplePlanAction(data: FormData) {
  return authorized("production", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      pausePlan(tx, scope, requiredText(data, "planId", "打样计划标识"), {
        resolutions: parseMaterialResolutions(data),
      }),
      transactionOptions(),
    );
    const handled = [
      result.returnedQty > 0 ? `回库 ${result.returnedQty}` : null,
      result.keptQty > 0 ? `留用 ${result.keptQty}` : null,
      result.lostQty > 0 ? `报损 ${result.lostQty}` : null,
    ].filter((part): part is string => Boolean(part));
    return result.wasStarted
      ? `打样已暂停：释放未领用预留 ${result.releasedQty}${handled.length > 0 ? `，制作区${handled.join("、")}` : ""}；恢复后可继续`
      : `打样已暂停：释放预留 ${result.releasedQty}；恢复时会重新检查现货`;
  });
}

export async function resumeSamplePlanAction(data: FormData) {
  return authorized("production", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      resumePlan(tx, scope, requiredText(data, "planId", "打样计划标识")),
      transactionOptions(),
    );
    return result.shortageQty > 0
      ? `打样已恢复，已重新预留 ${result.reservedQty}，仍缺料 ${result.shortageQty}，请补购后重算`
      : `打样已恢复，状态 ${result.state}，已重新预留 ${result.reservedQty}`;
  });
}

export async function recalculateSamplePlanAction(data: FormData) {
  // Re-planning releases the old reservation and creates a new one, so it uses
  // the same catalog capability as approval.
  return authorized("catalog", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      recalculatePlan(tx, scope, requiredText(data, "planId", "打样计划标识")),
      transactionOptions(),
    );
    const top = result.runs[0];
    return `计划已原地重算：释放旧预留 ${result.releasedReservations}，生成 ${result.runs.length} 个方案${top ? `，首选方案总成本 ¥${top.totalCost.toFixed(2)}` : ""}，请重新批准`;
  });
}

export async function completeSampleStepAction(data: FormData) {
  return authorized("production", async (scope) => {
    const materials = parseJsonArray<SamplePlanStepActualInput>(data, "actualsJson", "实际用量");
    const result = await v2db.$transaction((tx) =>
      completeStep(tx, scope, requiredText(data, "planId", "打样计划标识"), {
        materials,
        disassemble: text(data, "disassemble") === "true",
        lossReason: text(data, "lossReason") || null,
      }),
      transactionOptions(),
    );
    return result.planCompleted
      ? `打样计划已完成，实际成本 ¥${result.actualCost.toFixed(2)}`
      : `本步已完成：用量 ${result.usedQty}，损耗 ${result.lostQty}，留在制作区可复用 ${result.reusableQty}`;
  });
}

function parseMaterialResolutions(data: FormData): CancelSamplePlanInput["resolutions"] {
  const batchIds = data.getAll("resolutionBatchId")
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return batchIds.map((batchId) => {
    const returnQty = Number(text(data, `resolutionReturnQty_${batchId}`) || 0);
    const keepQty = Number(text(data, `resolutionKeepQty_${batchId}`) || 0);
    const lossQty = Number(text(data, `resolutionLossQty_${batchId}`) || 0);
    const rawUsableUntil = text(data, `resolutionUsableUntil_${batchId}`);
    const usableUntil = rawUsableUntil ? new Date(rawUsableUntil) : null;
    if (usableUntil && !Number.isFinite(usableUntil.getTime())) {
      throw new Error("回库最晚可用时间无效");
    }
    return {
      batchId,
      returnQty,
      keepQty,
      lossQty,
      reverified: data.get(`resolutionReverified_${batchId}`) !== null,
      usableUntil,
    };
  });
}

export async function cancelSamplePlanAction(data: FormData) {
  return authorized("catalog", async (scope) => {
    const result = await v2db.$transaction((tx) =>
      cancelPlan(tx, scope, requiredText(data, "planId", "打样计划标识"), {
        reason: requiredText(data, "reason", "取消原因"),
        resolutions: parseMaterialResolutions(data),
      }),
      transactionOptions(),
    );
    return `计划已取消：释放预留 ${result.releasedReservations}，回库 ${result.returnedQty}，留用 ${result.keptQty}，报损 ${result.lostQty}`;
  });
}
