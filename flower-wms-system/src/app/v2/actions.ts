"use server";

import { redirect } from "next/navigation";
import { MaterialKind, RecipeState } from "@/generated/prisma-v2/client";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { generateBatchNumber, generateProductCode, generateSkuCode } from "@/v2/domain/identifiers";
import { assertMaterialQuantity } from "@/v2/domain/stock-planning";
import { completeDelivery } from "@/v2/services/complete-delivery";
import { completeProduction, type ActualMaterialUsageInput } from "@/v2/services/complete-production";
import { allocatePurchaseDemand as allocatePurchaseDemandService } from "@/v2/services/allocate-purchase-demand";
import { confirmManualOrder, createManualOrder } from "@/v2/services/manual-order";
import { receivePurchaseLine } from "@/v2/services/receive-purchase-line";
import { recheckSupplyAfterReceipt } from "@/v2/services/recheck-supply";
import { rejectPurchaseLine } from "@/v2/services/reject-purchase-line";
import { reviseManualOrder } from "@/v2/services/revise-order";
import { substituteOrderMaterial as substituteOrderMaterialService } from "@/v2/services/substitute-order-material";

function field(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}
function number(data: FormData, key: string): number {
  const parsed = Number(field(data, key));
  if (!Number.isFinite(parsed)) throw new Error(`${key} 必须为数字`);
  return parsed;
}
async function submit(action: () => Promise<string | void>, success: string, redirectPath = "/v2"): Promise<void> {
  let message = success;
  let error: string | null = null;
  try { message = (await action()) ?? success; } catch (cause) { error = cause instanceof Error ? cause.message : "操作失败"; }
  redirect(`${redirectPath}?${error ? `error=${encodeURIComponent(error)}` : `message=${encodeURIComponent(message)}`}`);
}

const USAGE_FIELD = /^usage\.([^.]+)\.([^.]+)\.(usedQty|lostQty|returnedQty|reason)$/;
const LEGACY_USAGE_FIELD = /^usage\.([^.]+)\.(usedQty|lostQty|returnedQty|reason)$/;

function usageNumber(
  data: FormData,
  prefix: string,
  key: "usedQty" | "lostQty" | "returnedQty",
  label: string,
): number | undefined {
  const raw = field(data, `${prefix}.${key}`);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须为数字`);
  return parsed;
}

/**
 * Only usage rows actually present in the submitted exception form are parsed.
 * New markup keys each row by task + batch so a shared batch stays attributable.
 * Legacy batch-only keys are still accepted for single-task callers; completeProduction
 * verifies every pair against the order's latest reservations.
 */
function parseActualUsage(data: FormData): ActualMaterialUsageInput[] {
  const rows = new Map<string, { taskId?: string; batchId: string }>();
  const batchesWithTaskKey = new Set<string>();
  for (const key of data.keys()) {
    const match = USAGE_FIELD.exec(key);
    if (!match) continue;
    const [, taskId, batchId] = match;
    rows.set(`${taskId}\u0000${batchId}`, { taskId, batchId });
    batchesWithTaskKey.add(batchId);
  }
  for (const key of data.keys()) {
    const match = LEGACY_USAGE_FIELD.exec(key);
    if (!match) continue;
    const [, batchId] = match;
    if (batchesWithTaskKey.has(batchId)) continue;
    rows.set(`\u0000${batchId}`, { batchId });
  }
  return [...rows.values()]
    .sort((left, right) => left.batchId.localeCompare(right.batchId) ||
      (left.taskId ?? "").localeCompare(right.taskId ?? ""))
    .map(({ taskId, batchId }) => {
      const prefix = taskId ? `usage.${taskId}.${batchId}` : `usage.${batchId}`;
      const usedQty = usageNumber(data, prefix, "usedQty", "实际用量");
      if (usedQty === undefined) throw new Error("实际用量必填");
      const reason = field(data, `${prefix}.reason`);
      return {
        ...(taskId ? { taskId } : {}),
        batchId,
        usedQty,
        lostQty: usageNumber(data, prefix, "lostQty", "损耗数量"),
        returnedQty: usageNumber(data, prefix, "returnedQty", "退料数量"),
        differenceReason: reason || null,
      };
    });
}

export async function createMaterial(data: FormData) {
  await submit(async () => {
    const { tenantId } = await requireV2Store("catalog");
    const kind = field(data, "kind") as MaterialKind;
    if (!Object.values(MaterialKind).includes(kind)) throw new Error("物料类别无效");
    const quantityScale = number(data, "quantityScale");
    assertMaterialQuantity(0, quantityScale);
    if (!field(data, "code") || !field(data, "name") || !field(data, "baseUnit")) throw new Error("请填写物料编码、名称和单位");
    await v2db.material.create({ data: {
      tenantId, code: field(data, "code"), name: field(data, "name"), kind,
      color: field(data, "color") || null, grade: field(data, "grade") || null,
      specification: field(data, "specification") || null,
      baseUnit: field(data, "baseUnit"), quantityScale,
      reservePerOrder: field(data, "reservePerOrder") === "on",
    } });
  }, "物料已创建");
}

export async function createSupplier(data: FormData) {
  await submit(async () => {
    const { tenantId } = await requireV2Store("purchase");
    if (!field(data, "code") || !field(data, "name")) throw new Error("请填写供应商编码和名称");
    await v2db.supplier.create({ data: { tenantId, code: field(data, "code"), name: field(data, "name") } });
  }, "供应商已创建");
}

export async function createPurchase(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("purchase");
    const supplierId = field(data, "supplierId");
    const materialId = field(data, "materialId");
    const [supplier, material] = await Promise.all([
      v2db.supplier.findUnique({ where: { id: supplierId } }),
      v2db.material.findUnique({ where: { id: materialId } }),
    ]);
    if (!supplier || supplier.tenantId !== tenantId || !material || material.tenantId !== tenantId) throw new Error("供应商或物料不属于当前门店");
    const quantity = number(data, "quantity");
    assertMaterialQuantity(quantity, material.quantityScale);
    if (quantity <= 0) throw new Error("采购数量必须大于零");
    const unitPrice = number(data, "unitPrice");
    if (unitPrice < 0) throw new Error("采购价不能为负数");
    const requirementId = field(data, "requirementId");
    const allocationQuantity = requirementId ? number(data, "allocationQuantity") : null;
    const purchaseOrderNumber = `PO-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    await v2db.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          tenantId, storeId, supplierId, number: purchaseOrderNumber,
          state: "ORDERED",
          lines: { create: { materialId, orderedQty: quantity, purchaseUnit: material.baseUnit, expectedBaseQty: quantity, unitPrice } },
        },
        include: { lines: { select: { id: true } } },
      });
      if (requirementId && allocationQuantity !== null) {
        const purchaseLine = purchaseOrder.lines[0];
        if (!purchaseLine) throw new Error("采购单缺少采购明细");
        await allocatePurchaseDemandService(tx, {
          tenantId,
          storeId,
          purchaseLineId: purchaseLine.id,
          requirementId,
          quantity: allocationQuantity,
          actorStaffId: staffId,
        });
      }
    });
    return requirementId
      ? `${purchaseOrderNumber} 已创建并关联缺料需求`
      : `${purchaseOrderNumber} 已创建`;
  }, "采购单已创建", "/v2/purchases");
}

export async function receivePurchase(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("purchase");
    const location = await v2db.inventoryLocation.findFirst({ where: { storeId, kind: "WAREHOUSE" } });
    if (!location) throw new Error("缺少仓库库位");
    const purchaseLineId = field(data, "purchaseLineId");
    const disposition = field(data, "disposition") === "DOWNGRADED" ? "DOWNGRADED" as const : "ACCEPTED" as const;
    const batchId = await v2db.$transaction(async (tx) => {
      const line = await tx.purchaseOrderLine.findUnique({
        where: { id: purchaseLineId },
        select: {
          materialId: true,
          purchaseOrder: { select: { tenantId: true, storeId: true } },
        },
      });
      if (!line ||
          line.purchaseOrder.tenantId !== tenantId ||
          line.purchaseOrder.storeId !== storeId) {
        throw new Error("采购明细不存在或不属于当前门店");
      }
      return receivePurchaseLine(tx, {
        tenantId,
        actorStaffId: staffId,
        purchaseLineId,
        locationId: location.id,
        // ACCEPTED always receives the ordered material; only a downgrade may name another one.
        acceptedMaterialId: disposition === "ACCEPTED" ? line.materialId : field(data, "acceptedMaterialId"),
        quantity: number(data, "quantity"),
        batchNo: generateBatchNumber(new Date(), crypto.randomUUID()),
        disposition,
        gradeChangeReason: field(data, "gradeChangeReason") || undefined,
        finalUnitCost: number(data, "finalUnitCost"),
        usableUntil: field(data, "usableUntil") ? new Date(field(data, "usableUntil")) : undefined,
        idempotencyKey: formIdempotencyKey(data, "RECEIPT"),
      });
    });
    const batch = await v2db.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } });
    await recheckSupplyAfterReceipt(v2db, tenantId, storeId, batch.materialId, { purchaseLineId });
  }, "验收入库完成", "/v2/purchase-orders");
}

export async function allocatePurchaseDemand(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("purchase");
    const result = await v2db.$transaction((tx) => allocatePurchaseDemandService(tx, {
      tenantId,
      storeId,
      purchaseLineId: field(data, "purchaseLineId"),
      requirementId: field(data, "requirementId"),
      quantity: number(data, "quantity"),
      actorStaffId: staffId,
    }));
    const amount = `${result.allocatedQty}${result.baseUnit}`;
    if (!result.changed) return `该采购明细已向此需求分配 ${amount}，无需重复操作`;
    return `已将 ${amount} 从 ${result.purchaseOrderNumber} 分配给最新版需求，待分配缺口 ${result.requirement.remainingShortage}${result.baseUnit}`;
  }, "采购需求分配已保存", "/v2/orders");
}

const PURCHASE_STATE_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ORDERED: "已下单",
  PARTIALLY_RECEIVED: "部分验收",
  RECEIVED: "已收货",
  CANCELLED: "已取消",
  CLOSED: "已关闭",
};

function purchaseStateText(state: string): string {
  return PURCHASE_STATE_LABELS[state] ?? state;
}

function quantityText(value: number): string {
  return String(Number(value.toFixed(3)));
}

export async function rejectPurchase(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("purchase");
    const purchaseLineId = field(data, "purchaseLineId");
    const quantity = number(data, "quantity");
    const result = await v2db.$transaction((tx) => rejectPurchaseLine(tx, {
      tenantId,
      storeId,
      purchaseLineId,
      quantity,
      reason: field(data, "reason"),
      actorStaffId: staffId,
      idempotencyKey: formIdempotencyKey(data, "REJECT"),
    }));
    const line = await v2db.purchaseOrderLine.findUnique({
      where: { id: purchaseLineId },
      select: { material: { select: { baseUnit: true } } },
    });
    const unit = line?.material.baseUnit ?? "";
    const { progress } = result;
    const remaining = progress.remainingQty > 1e-8
      ? `剩余 ${quantityText(progress.remainingQty)}${unit} 待验收，仍可继续验收或拒收`
      : "该采购行已全部处理，不能继续验收";
    return `已拒收 ${quantityText(quantity)}${unit}，累计拒收 ${quantityText(progress.rejectedQty)}${unit}；` +
      `采购单状态：${purchaseStateText(result.purchaseState)}，${remaining}`;
  }, "拒收已记录，可用库存未增加", "/v2/purchase-orders");
}

export async function createProduct(data: FormData) {
  await submit(async () => {
    const { tenantId } = await requireV2Store("catalog");
    if (!field(data, "name")) throw new Error("请填写商品名称");
    await v2db.product.create({ data: {
      tenantId,
      code: generateProductCode(new Date(), crypto.randomUUID()),
      name: field(data, "name"),
    } });
  }, "商品已创建，可添加 SKU");
}

async function parseRecipe(tenantId: string, recipeText: string) {
  const entries = recipeText.split(/[\n;]+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [materialId, quantityText] = line.split(/[,，:：]/).map((part) => part.trim());
    return { materialId, quantity: Number(quantityText) };
  });
  if (!entries.length) throw new Error("配方至少需要一项物料，格式：物料ID,每件用量");
  const materials = await v2db.material.findMany({ where: { id: { in: entries.map((entry) => entry.materialId) }, tenantId } });
  for (const entry of entries) {
    const material = materials.find((item) => item.id === entry.materialId);
    if (!material || entry.quantity <= 0) throw new Error("配方物料或用量无效");
    assertMaterialQuantity(entry.quantity, material.quantityScale);
  }
  return entries;
}

async function publishSkuRecipe(skuId: string, tenantId: string, recipeText: string) {
  const entries = await parseRecipe(tenantId, recipeText);
  await v2db.$transaction(async (tx) => {
    const recipe = await tx.recipe.upsert({ where: { skuId }, create: { skuId }, update: {} });
    await tx.$queryRaw`SELECT id FROM "Recipe" WHERE id = ${recipe.id} FOR UPDATE`;
    const latest = await tx.recipeVersion.findFirst({ where: { recipeId: recipe.id }, orderBy: { versionNo: "desc" } });
    await tx.recipeVersion.updateMany({ where: { recipeId: recipe.id, state: RecipeState.PUBLISHED }, data: { state: RecipeState.RETIRED } });
    await tx.recipeVersion.create({ data: {
      recipeId: recipe.id, versionNo: (latest?.versionNo ?? 0) + 1,
      state: RecipeState.PUBLISHED, publishedAt: new Date(), effectiveAt: new Date(),
      lines: { create: entries.map((entry) => ({ materialId: entry.materialId, plannedQty: entry.quantity })) },
    } });
  });
}

export async function createSku(data: FormData) {
  await submit(async () => {
    const { tenantId } = await requireV2Store("catalog");
    const product = await v2db.product.findUnique({ where: { id: field(data, "productId") } });
    if (!product || product.tenantId !== tenantId) throw new Error("商品不存在");
    const price = number(data, "price");
    const estimatedConsumableCost = number(data, "estimatedConsumableCost");
    const estimatedLaborCost = number(data, "estimatedLaborCost");
    if (price < 0 || estimatedConsumableCost < 0 || estimatedLaborCost < 0 || !field(data, "name")) throw new Error("SKU 名称、价格或成本无效");
    const entries = await parseRecipe(tenantId, field(data, "recipe"));
    await v2db.$transaction(async (tx) => {
      const sku = await tx.productSku.create({ data: {
        productId: product.id,
        code: generateSkuCode(new Date(), crypto.randomUUID()),
        name: field(data, "name"),
        price,
        estimatedConsumableCost,
        estimatedLaborCost,
        active: true,
      } });
      await tx.recipe.create({ data: {
        skuId: sku.id,
        versions: { create: {
          versionNo: 1, state: RecipeState.PUBLISHED, effectiveAt: new Date(), publishedAt: new Date(),
          lines: { create: entries.map((entry) => ({ materialId: entry.materialId, plannedQty: entry.quantity })) },
        } },
      } });
      await tx.product.update({ where: { id: product.id }, data: { active: true, defaultSkuId: product.defaultSkuId ?? sku.id } });
    });
  }, "SKU 和配方已发布");
}

export async function setDefaultSku(data: FormData) {
  await submit(async () => {
    const { tenantId } = await requireV2Store("catalog");
    const sku = await v2db.productSku.findUnique({ where: { id: field(data, "skuId") }, include: { product: true } });
    if (!sku?.active || sku.product.tenantId !== tenantId) throw new Error("只能选择当前商品的启用 SKU");
    await v2db.product.update({ where: { id: sku.productId }, data: { defaultSkuId: sku.id } });
  }, "默认 SKU 已更新");
}

export async function updateSkuPrice(data: FormData) {
  await submit(async () => {
    const { tenantId } = await requireV2Store("catalog");
    const sku = await v2db.productSku.findUnique({ where: { id: field(data, "skuId") }, include: { product: true } });
    if (!sku || sku.product.tenantId !== tenantId) throw new Error("SKU 不存在");
    const price = number(data, "price");
    if (price < 0) throw new Error("售价不能为负数");
    await v2db.productSku.update({ where: { id: sku.id }, data: { price } });
  }, "SKU 售价已更新，历史订单价格保持不变");
}

export async function reviseSkuRecipe(data: FormData) {
  await submit(async () => {
    const { tenantId } = await requireV2Store("catalog");
    const sku = await v2db.productSku.findUnique({ where: { id: field(data, "skuId") }, include: { product: true } });
    if (!sku || sku.product.tenantId !== tenantId) throw new Error("SKU 不存在");
    await publishSkuRecipe(sku.id, tenantId, field(data, "recipe"));
  }, "新配方版本已发布，既有订单版本保持不变");
}

export async function createOrder(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId } = await requireV2Store("order");
    const itemSkuIds = data.getAll("itemSkuId")
      .map((value) => typeof value === "string" ? value.trim() : "");
    const itemQuantities = data.getAll("itemQuantity")
      .map((value) => typeof value === "string" ? Number(value.trim()) : Number.NaN);
    const common = {
      tenantId, storeId,
      deliveryAt: new Date(field(data, "deliveryAt")), buyerName: field(data, "buyerName"),
      fulfillmentKind: field(data, "fulfillmentKind") === "PICKUP" ? "PICKUP" as const : "DELIVERY" as const,
      recipientName: field(data, "recipientName"), recipientPhone: field(data, "recipientPhone"),
      address: field(data, "address"), deliveryFee: number(data, "deliveryFee"),
      estimatedDeliveryCost: number(data, "estimatedDeliveryCost"),
    };
    if (itemSkuIds.length > 0 || itemQuantities.length > 0) {
      if (itemSkuIds.length === 0 || itemSkuIds.length !== itemQuantities.length) {
        throw new Error("商品行 SKU 与数量必须一一对应");
      }
      await createManualOrder(v2db, {
        ...common,
        items: itemSkuIds.map((skuId, index) => ({ skuId, quantity: itemQuantities[index] })),
      });
      return;
    }
    await createManualOrder(v2db, {
      ...common,
      skuId: field(data, "skuId"), quantity: number(data, "quantity"),
    });
  }, "订单草稿已创建");
}

export async function confirmOrder(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId } = await requireV2Store("order");
    await confirmManualOrder(v2db, field(data, "orderId"), tenantId, storeId);
  }, "订单已核对供应状态");
}

export async function reviseOrder(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId } = await requireV2Store("order");
    const deliveryAtText = field(data, "deliveryAt");
    if (!deliveryAtText) throw new Error("请选择交付时间");
    const itemQuantityKeys = [...data.keys()]
      .filter((key) => key.startsWith("itemQuantity.") && key.length > "itemQuantity.".length);
    const parallelItemIds = data.getAll("orderItemId")
      .map((value) => typeof value === "string" ? value.trim() : "");
    const parallelItemQuantities = data.getAll("itemQuantity")
      .map((value) => typeof value === "string" ? Number(value.trim()) : Number.NaN);
    const deliveryAt = new Date(deliveryAtText);
    let revisedItems: { orderItemId: string; quantity: number }[] | undefined;
    if (itemQuantityKeys.length > 0) {
      revisedItems = itemQuantityKeys.map((key) => ({
        orderItemId: key.slice("itemQuantity.".length),
        quantity: number(data, key),
      }));
    } else if (parallelItemIds.length > 0 || parallelItemQuantities.length > 0) {
      if (parallelItemIds.length === 0 || parallelItemIds.length !== parallelItemQuantities.length) {
        throw new Error("商品行与数量必须一一对应");
      }
      revisedItems = parallelItemIds.map((orderItemId, index) => ({
        orderItemId,
        quantity: parallelItemQuantities[index],
      }));
    }
    const result = revisedItems
      ? await reviseManualOrder(v2db, {
          tenantId,
          storeId,
          orderId: field(data, "orderId"),
          deliveryAt,
          items: revisedItems,
        })
      : await reviseManualOrder(v2db, {
          tenantId,
          storeId,
          orderId: field(data, "orderId"),
          quantity: number(data, "quantity"),
          deliveryAt,
        });
    if (result.covered) return `订单已修改为第 ${result.revisionNumber} 版，现货已覆盖，可制作`;
    if (result.totalShortage > 0) return `订单已修改为第 ${result.revisionNumber} 版，仍缺料，待采购`;
    return `订单草稿已更新为第 ${result.revisionNumber} 版，确认后检查供应`;
  }, "订单已修改");
}

/**
 * Explicit human substitution for one latest-revision shortage. The service rechecks capability
 * scoping (tenant/store), order lifecycle, material compatibility and customer confirmation.
 */
export async function substituteOrderMaterial(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("order");
    const result = await substituteOrderMaterialService(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      requirementId: field(data, "requirementId"),
      replacementMaterialId: field(data, "replacementMaterialId"),
      replacementQty: number(data, "replacementQty"),
      reason: field(data, "reason"),
      customerConfirmed: data.get("customerConfirmed") !== null,
      actorStaffId: staffId,
    });
    if (result.covered) {
      return `物料已人工替换，订单第 ${result.revisionNumber} 版现货已覆盖`;
    }
    return `物料已人工替换，订单第 ${result.revisionNumber} 版仍缺 ${result.totalShortage}${result.baseUnit}`;
  }, "物料已人工替换");
}

export async function finishProduction(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId } = await requireV2Store("production");
    await completeProduction(v2db, field(data, "orderId"), tenantId, storeId);
  }, "制作已完成，库存与成本已结转");
}

export async function finishProductionWithUsage(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId } = await requireV2Store("production");
    const actualUsage = parseActualUsage(data);
    if (actualUsage.length === 0) throw new Error("请至少登记一个批次的实际用料");
    await completeProduction(v2db, field(data, "orderId"), tenantId, storeId, actualUsage);
    return `制作完成，已登记 ${actualUsage.length} 个批次的实际用料`;
  }, "制作完成，实际用料已登记");
}

export async function finishDelivery(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("delivery");
    await completeDelivery(v2db, field(data, "orderId"), tenantId, storeId, staffId);
  }, "交付完成，成本快照已生成");
}

/**
 * Forms render a per-request hidden key. The fallback keeps direct posts retry-safe instead of
 * failing open into a duplicate payment/refund when older markup omits the field.
 */
function formIdempotencyKey(data: FormData, prefix: string): string {
  return field(data, "idempotencyKey") || `${prefix}-${crypto.randomUUID()}`;
}

// Financial services are loaded lazily: normal order/production actions keep their existing
// startup dependency graph, and the exception screens only pay for these modules when used.
export async function recordOfflinePayment(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId, staffId } = await requireV2Store("order");
    const { recordManualPayment } = await import("@/v2/services/record-manual-payment");
    const payment = await recordManualPayment(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      amount: field(data, "amount"),
      method: field(data, "method"),
      externalReference: field(data, "externalReference") || null,
      idempotencyKey: formIdempotencyKey(data, "PAY"),
      confirmedById: staffId,
    });
    return `线下收款已记录：¥${Number(payment.amount).toFixed(2)}`;
  }, "线下收款已记录");
}

export async function recordOfflineRefund(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId } = await requireV2Store("order");
    const { recordRefund } = await import("@/v2/services/record-refund");
    const refund = await recordRefund(v2db, {
      tenantId,
      storeId,
      orderId: field(data, "orderId"),
      paymentId: field(data, "paymentId"),
      amount: field(data, "amount"),
      reason: field(data, "reason"),
      externalReference: field(data, "externalReference") || null,
      idempotencyKey: formIdempotencyKey(data, "REFUND"),
    });
    return `部分退款已记录：¥${Number(refund.amount).toFixed(2)}`;
  }, "部分退款已记录");
}

export async function finalizeBatchCost(data: FormData) {
  await submit(async () => {
    const { tenantId, storeId } = await requireV2Store("purchase");
    const { adjustFinalCost } = await import("@/v2/services/adjust-final-cost");
    const result = await adjustFinalCost(v2db, {
      tenantId,
      storeId,
      batchId: field(data, "batchId"),
      finalUnitCost: field(data, "finalUnitCost"),
      reason: field(data, "reason"),
    });
    if (result.alreadyFinalized) return `批次成本已是最终成本：¥${result.finalUnitCost.toFixed(4)}`;
    return `批次成本已确认：更新 ${result.costEntriesUpdated} 条成本，生成 ${result.adjustmentsCreated} 条调整`;
  }, "批次成本已最终确认");
}
