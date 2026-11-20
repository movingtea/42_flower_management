"use server";

import { redirect } from "next/navigation";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  saveProduct,
  saveSku,
  setDefaultSku,
  setProductActive,
  setSkuActive,
} from "@/v2/services/catalog-management";
import { runV2DrawerAction } from "../_lib/action-result";

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(data: FormData, key: string, label: string): string {
  const value = text(data, key);
  if (!value) throw new Error(`${label}必填`);
  return value;
}

function numberValue(data: FormData, key: string, label: string): number {
  const raw = text(data, key);
  if (!raw) throw new Error(`${label}必填`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label}必须为数字`);
  return value;
}

function checkbox(data: FormData, key: string): boolean {
  return data.get(key) !== null;
}

function checkedIds(data: FormData, key: string): string[] {
  return data.getAll(key).filter((value): value is string => typeof value === "string" && value.length > 0);
}

function isNextRedirect(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "digest" in cause;
}

/** Runs a catalog mutation and always redirects back to the list with Chinese feedback. */
async function finish(operation: () => Promise<string>): Promise<never> {
  try {
    const message = await operation();
    redirect(`/v2/catalog?message=${encodeURIComponent(message)}`);
  } catch (cause) {
    if (isNextRedirect(cause)) throw cause;
    redirect(`/v2/catalog?error=${encodeURIComponent(cause instanceof Error ? cause.message : "操作失败")}`);
  }
}

export async function createProductAction(data: FormData) {
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store("catalog");
    const name = requiredText(data, "name", "商品名称");
    const result = await v2db.$transaction((tx) =>
      saveProduct(tx, { ...scope, actorStaffId: scope.staffId }, { name, active: false, imageKey: text(data, "imageKey") || null }),
    );
    return `商品 ${result.code} 已创建，请添加 SKU 后再启用`;
  }, "商品已创建");
}

export async function updateProductAction(data: FormData) {
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store("catalog");
    const productId = requiredText(data, "productId", "商品标识");
    const name = requiredText(data, "name", "商品名称");
    const defaultSkuId = text(data, "defaultSkuId") || null;
    const activeSkuIds = checkedIds(data, "activeSkuIds");
    await v2db.$transaction((tx) =>
      saveProduct(tx, { ...scope, actorStaffId: scope.staffId }, {
        id: productId,
        name,
        active: checkbox(data, "active"),
        defaultSkuId,
        activeSkuIds,
        imageKey: text(data, "imageKey") || null,
      }),
    );
    return "商品已保存";
  }, "商品已保存");
}

export async function createSkuAction(data: FormData) {
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store("catalog");
    const productId = requiredText(data, "productId", "商品标识");
    const result = await v2db.$transaction((tx) =>
      saveSku(tx, { ...scope, actorStaffId: scope.staffId }, {
        productId,
        name: requiredText(data, "name", "规格名称"),
        price: numberValue(data, "price", "售价"),
        estimatedConsumableCost: numberValue(data, "estimatedConsumableCost", "耗材估算"),
        estimatedLaborCost: numberValue(data, "estimatedLaborCost", "人工估算"),
        active: checkbox(data, "active"),
        sourceSampleId: text(data, "sourceSampleId") || null,
        imageKey: text(data, "imageKey") || null,
      }),
    );
    return `SKU ${result.code} 已创建`;
  }, "SKU 已创建");
}

export async function updateSkuAction(data: FormData) {
  return runV2DrawerAction(async () => {
    const scope = await requireV2Store("catalog");
    const skuId = requiredText(data, "skuId", "SKU 标识");
    const productId = requiredText(data, "productId", "商品标识");
    const result = await v2db.$transaction((tx) =>
      saveSku(tx, { ...scope, actorStaffId: scope.staffId }, {
        id: skuId,
        productId,
        name: requiredText(data, "name", "规格名称"),
        price: numberValue(data, "price", "售价"),
        estimatedConsumableCost: numberValue(data, "estimatedConsumableCost", "耗材估算"),
        estimatedLaborCost: numberValue(data, "estimatedLaborCost", "人工估算"),
        active: checkbox(data, "active"),
        sourceSampleId: text(data, "sourceSampleId") || null,
        imageKey: text(data, "imageKey") || null,
      }),
    );
    return `SKU ${result.code} 已更新`;
  }, "SKU 已更新");
}

export async function setDefaultSkuAction(data: FormData) {
  const scope = await requireV2Store("catalog");
  return finish(async () => {
    const productId = requiredText(data, "productId", "商品标识");
    const skuId = requiredText(data, "skuId", "SKU 标识");
    await v2db.$transaction((tx) =>
      setDefaultSku(tx, { ...scope, actorStaffId: scope.staffId }, productId, skuId),
    );
    return "默认 SKU 已更新";
  });
}

export async function setProductActiveAction(data: FormData) {
  const scope = await requireV2Store("catalog");
  return finish(async () => {
    const productId = requiredText(data, "productId", "商品标识");
    const active = text(data, "active") === "true";
    await v2db.$transaction((tx) =>
      setProductActive(tx, { ...scope, actorStaffId: scope.staffId }, productId, active),
    );
    return active ? "商品已启用" : "商品已停用";
  });
}

export async function setSkuActiveAction(data: FormData) {
  const scope = await requireV2Store("catalog");
  return finish(async () => {
    const skuId = requiredText(data, "skuId", "SKU 标识");
    const active = text(data, "active") === "true";
    await v2db.$transaction((tx) =>
      setSkuActive(tx, { ...scope, actorStaffId: scope.staffId }, skuId, active),
    );
    return active ? "SKU 已启用" : "SKU 已停用";
  });
}
