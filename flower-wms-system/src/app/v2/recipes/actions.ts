"use server";

import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  publishRecipeVersion,
  retireRecipeVersion,
  saveRecipeDraft,
} from "@/v2/services/recipe-management";
import { runV2DrawerAction } from "../_lib/action-result";

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

type ParsedLine = { materialId: string; quantity: number };

/** Hidden JSON is untrusted input; malformed values become Chinese feedback. */
function parseLines(data: FormData): ParsedLine[] {
  const raw = text(data, "lines");
  if (!raw) throw new Error("配方物料格式无效");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("配方物料格式无效");
  }
  if (!Array.isArray(parsed)) throw new Error("配方物料格式无效");
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("配方物料格式无效");
    const record = entry as Record<string, unknown>;
    const materialId =
      typeof record.materialId === "string" ? record.materialId.trim() : "";
    const quantity =
      typeof record.quantity === "number" ? record.quantity : Number(record.quantity);
    return { materialId, quantity };
  });
}

export async function saveRecipeDraftAction(data: FormData) {
  const versionId = text(data, "versionId");
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store("catalog");
    const result = await v2db.$transaction((tx) =>
      saveRecipeDraft(
        tx,
        { ...scope, actorStaffId: scope.staffId },
        {
          skuId: text(data, "skuId"),
          ...(versionId ? { versionId } : {}),
          lines: parseLines(data),
        },
      ),
    );
    return versionId
      ? `配方草稿 v${result.versionNo} 已保存`
      : `配方草稿 v${result.versionNo} 已创建`;
  }, versionId ? "配方草稿已保存" : "配方草稿已创建");
}

export async function publishRecipeVersionAction(data: FormData) {
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store("catalog");
    const result = await v2db.$transaction((tx) =>
      publishRecipeVersion(
        tx,
        { ...scope, actorStaffId: scope.staffId },
        text(data, "versionId"),
      ),
    );
    return `配方 v${result.versionNo} 已发布${
      result.retiredVersionIds.length > 0 ? "，原发布版本已停用" : ""
    }`;
  }, "配方版本已发布");
}

export async function retireRecipeVersionAction(data: FormData) {
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store("catalog");
    const result = await v2db.$transaction((tx) =>
      retireRecipeVersion(
        tx,
        { ...scope, actorStaffId: scope.staffId },
        text(data, "versionId"),
      ),
    );
    return `配方 v${result.versionNo} 已停用`;
  }, "配方版本已停用");
}
