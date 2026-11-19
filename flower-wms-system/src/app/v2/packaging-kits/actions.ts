"use server";

import { redirect } from "next/navigation";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  savePackagingKit,
  setPackagingKitActive,
} from "@/v2/services/packaging-kit";

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

type ParsedLine = { materialId: string; quantity: number };

/** Hidden JSON is untrusted input; malformed values become Chinese feedback. */
function parseLines(data: FormData): ParsedLine[] {
  const raw = text(data, "lines");
  if (!raw) throw new Error("包装物料格式无效");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("包装物料格式无效");
  }
  if (!Array.isArray(parsed)) throw new Error("包装物料格式无效");
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("包装物料格式无效");
    const record = entry as Record<string, unknown>;
    const materialId =
      typeof record.materialId === "string" ? record.materialId.trim() : "";
    const quantity =
      typeof record.quantity === "number" ? record.quantity : Number(record.quantity);
    return { materialId, quantity };
  });
}

function isFrameworkRedirect(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "digest" in cause
  );
}

async function run(operation: () => Promise<void>, success: string): Promise<never> {
  try {
    await operation();
    redirect(`/v2/packaging-kits?message=${encodeURIComponent(success)}`);
  } catch (cause) {
    if (isFrameworkRedirect(cause)) throw cause;
    redirect(
      `/v2/packaging-kits?error=${encodeURIComponent(
        cause instanceof Error ? cause.message : "操作失败",
      )}`,
    );
  }
}

export async function savePackagingKitAction(data: FormData): Promise<never> {
  const id = text(data, "id");
  return run(async () => {
    const scope = await requireV2Store("catalog");
    await v2db.$transaction((tx) =>
      savePackagingKit(
        tx,
        { ...scope, actorStaffId: scope.staffId },
        {
          id: id || undefined,
          // No code field: the service generates one on create and keeps the
          // stored code on edit.
          name: text(data, "name"),
          notes: text(data, "notes"),
          lines: parseLines(data),
        },
      ),
    );
  }, id ? "包装方案已更新" : "包装方案已创建");
}

export async function setPackagingKitActiveAction(data: FormData): Promise<never> {
  const active = text(data, "active") === "true";
  const id = text(data, "id");
  return run(async () => {
    const scope = await requireV2Store("catalog");
    await v2db.$transaction((tx) =>
      setPackagingKitActive(
        tx,
        { ...scope, actorStaffId: scope.staffId },
        id,
        active,
      ),
    );
  }, active ? "包装方案已启用" : "包装方案已停用");
}
