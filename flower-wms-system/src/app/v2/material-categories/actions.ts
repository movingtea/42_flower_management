"use server";
import { redirect } from "next/navigation";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  createMaterialCategory,
  deleteMaterialCategory,
  setMaterialCategoryActive,
  updateMaterialCategory,
} from "@/v2/services/material-category";
import { runV2DrawerAction } from "../_lib/action-result";

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

function categoryInput(data: FormData) {
  return {
    name: text(data, "name"),
    description: text(data, "description"),
    sortOrder: text(data, "sortOrder"),
  };
}

async function run(operation: () => Promise<void>, success: string): Promise<never> {
  try {
    await operation();
    redirect(`/v2/material-categories?message=${encodeURIComponent(success)}`);
  } catch (cause) {
    if (cause && typeof cause === "object" && "digest" in cause) throw cause;
    redirect(`/v2/material-categories?error=${encodeURIComponent(cause instanceof Error ? cause.message : "操作失败")}`);
  }
}

export async function createMaterialCategoryAction(data: FormData) {
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store("catalog");
    await v2db.$transaction((tx) =>
      createMaterialCategory(tx, { ...scope, actorStaffId: scope.staffId }, {
        ...categoryInput(data),
        active: text(data, "active") === "on",
      }),
    );
  }, "原材料分类已创建");
}

export async function updateMaterialCategoryAction(data: FormData) {
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store("catalog");
    await v2db.$transaction((tx) =>
      updateMaterialCategory(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "categoryId"), categoryInput(data)),
    );
  }, "原材料分类已更新");
}

export async function setMaterialCategoryActiveAction(data: FormData): Promise<never> {
  const active = text(data, "active") === "true";
  return run(async () => {
    const scope = await requireV2Store("catalog");
    await v2db.$transaction((tx) =>
      setMaterialCategoryActive(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "categoryId"), active),
    );
  }, active ? "原材料分类已启用" : "原材料分类已停用");
}

export async function deleteMaterialCategoryAction(data: FormData): Promise<never> {
  return run(async () => {
    const scope = await requireV2Store("catalog");
    await v2db.$transaction((tx) =>
      deleteMaterialCategory(tx, { ...scope, actorStaffId: scope.staffId }, text(data, "categoryId")),
    );
  }, "原材料分类已删除");
}
