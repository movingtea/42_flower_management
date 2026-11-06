"use server";

import { redirect } from "next/navigation";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  publishRecipeVersion,
  retireRecipeVersion,
  saveRecipeDraft,
} from "@/v2/services/recipe-management";

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

function isFrameworkRedirect(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "digest" in cause;
}

async function redirectWith(
  recipeId: string | undefined,
  key: "message" | "error",
  value: string,
): Promise<never> {
  const search = new URLSearchParams();
  if (recipeId) search.set("recipeId", recipeId);
  search.set(key, value);
  redirect(`/v2/recipes?${search.toString()}`);
}

async function run(
  operation: () => Promise<{ recipeId: string; message: string }>,
): Promise<never> {
  let recipeId: string | undefined;
  try {
    const result = await operation();
    recipeId = result.recipeId;
    return await redirectWith(recipeId, "message", result.message);
  } catch (cause) {
    if (isFrameworkRedirect(cause)) throw cause;
    return await redirectWith(
      recipeId,
      "error",
      cause instanceof Error ? cause.message : "操作失败",
    );
  }
}

export async function saveRecipeDraftAction(data: FormData): Promise<never> {
  const scope = await requireV2Store("catalog");
  const versionId = text(data, "versionId");
  return run(async () => {
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
    return {
      recipeId: result.recipeId,
      message: versionId
        ? `配方草稿 v${result.versionNo} 已保存`
        : `配方草稿 v${result.versionNo} 已创建`,
    };
  });
}

export async function publishRecipeVersionAction(data: FormData): Promise<never> {
  const scope = await requireV2Store("catalog");
  return run(async () => {
    const result = await v2db.$transaction((tx) =>
      publishRecipeVersion(
        tx,
        { ...scope, actorStaffId: scope.staffId },
        text(data, "versionId"),
      ),
    );
    return {
      recipeId: result.recipeId,
      message: `配方 v${result.versionNo} 已发布${
        result.retiredVersionIds.length > 0 ? "，原发布版本已停用" : ""
      }`,
    };
  });
}

export async function retireRecipeVersionAction(data: FormData): Promise<never> {
  const scope = await requireV2Store("catalog");
  return run(async () => {
    const result = await v2db.$transaction((tx) =>
      retireRecipeVersion(
        tx,
        { ...scope, actorStaffId: scope.staffId },
        text(data, "versionId"),
      ),
    );
    return {
      recipeId: result.recipeId,
      message: `配方 v${result.versionNo} 已停用`,
    };
  });
}
