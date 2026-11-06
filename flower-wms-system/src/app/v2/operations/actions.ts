"use server";

import { redirect } from "next/navigation";
import type { LossReason } from "@/generated/prisma-v2-draft/client";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { generateBatchNumber } from "@/v2/domain/identifiers";
import { createManualInbound } from "@/v2/services/manual-inbound";
import { adjustInventory, transferInventory } from "@/v2/services/inventory-operations";
import { confirmStocktake, createStocktakeDraft } from "@/v2/services/stocktake";
import { recordLoss } from "@/v2/services/loss-management";
import { LOSS_REASON_LABELS, LOSS_REASON_OPTIONS } from "./labels";

const STOCKTAKE_LINE_LIMIT = 3;

type V2StoreScope = { staffId: string; tenantId: string; storeId: string };

function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Parse a required numeric FormData field and fail with an actionable Chinese message. */
function numeric(data: FormData, key: string, label: string) {
  const raw = text(data, key);
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) throw new Error(`${label}必须填写为有效数字`);
  return value;
}

function serviceScope(scope: V2StoreScope) {
  return { tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.staffId };
}

function idempotencyKey(data: FormData, prefix: string) {
  return text(data, "idempotencyKey") || `${prefix}-${crypto.randomUUID()}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pick(value: unknown, keys: readonly string[]): string | undefined {
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) return item;
    if (typeof item === "number" && Number.isFinite(item)) return String(item);
  }
  return undefined;
}

function stocktakeIdFrom(result: unknown): string | undefined {
  if (typeof result === "string" && result.trim()) return result;
  const record = asRecord(result);
  return pick(record, ["stocktakeId"]) ?? pick(asRecord(record.stocktake), ["id"]) ?? pick(record, ["id"]);
}

function lossRecordIdFrom(result: unknown): string | undefined {
  if (typeof result === "string" && result.trim()) return result;
  const record = asRecord(result);
  return pick(record, ["lossRecordId", "lossId"]) ?? pick(asRecord(record.lossRecord), ["id"]) ?? pick(record, ["id"]);
}

function formatQty(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "—";
}

function run(operation: () => Promise<string>): Promise<never> {
  return (async () => {
    try {
      const message = await operation();
      redirect(`/v2/operations?message=${encodeURIComponent(message)}`);
    } catch (cause) {
      if (cause && typeof cause === "object" && "digest" in cause) throw cause;
      redirect(`/v2/operations?error=${encodeURIComponent(cause instanceof Error ? cause.message : "操作失败")}`);
    }
  })();
}

/** Keep the existing manual inbound workflow. */
export async function createManualInboundAction(data: FormData) {
  return run(async () => {
    const scope = await requireV2Store("purchase");
    const materialId = text(data, "materialId");
    const locationId = text(data, "locationId");
    if (!materialId || !locationId) throw new Error("请选择入库物料和库位");
    const quantity = numeric(data, "quantity", "入库数量");
    const unitCost = numeric(data, "unitCost", "最终单位成本");
    const rawDate = text(data, "usableUntil");
    const usableUntil = rawDate ? new Date(rawDate) : undefined;
    if (usableUntil && Number.isNaN(usableUntil.getTime())) throw new Error("最晚可用时间格式无效");
    const source = text(data, "source");
    const reason = text(data, "reason");
    if (!source || !reason) throw new Error("请填写入库来源和入库原因");
    const key = idempotencyKey(data, "MANUAL");

    return v2db.$transaction(async (tx) => {
      const batchId = await createManualInbound(tx, {
        ...serviceScope(scope),
        materialId,
        locationId,
        batchNo: generateBatchNumber(new Date(), crypto.randomUUID()),
        quantity,
        unitCost,
        usableUntil,
        source,
        reason,
        idempotencyKey: key,
      });
      const batch = await tx.inventoryBatch.findFirst({
        where: { id: batchId },
        include: { material: true, balances: { where: { locationId } } },
      });
      const unit = batch?.material.baseUnit ?? "";
      const onHand = batch?.balances[0]?.onHandQty;
      return `手工入库已完成：批次 ${batch?.batchNo ?? batchId}（${batch ? `${batch.material.code} ${batch.material.name}` : "物料"}）入库 ${quantity} ${unit}，入库后库位实存 ${formatQty(onHand)} ${unit}。`;
    });
  });
}

export async function adjustInventoryAction(data: FormData) {
  return run(async () => {
    const scope = await requireV2Store("purchase");
    const batchId = text(data, "batchId");
    const locationId = text(data, "locationId");
    const mode = text(data, "mode");
    if (!batchId || !locationId) throw new Error("请选择库存调整的批次和库位");
    if (mode !== "INCREASE" && mode !== "DECREASE") throw new Error("请选择有效的库存调整方向（增加或减少）");
    const quantity = numeric(data, "quantity", "调整数量");
    const reason = text(data, "reason");
    if (!reason) throw new Error("请填写库存调整原因");
    const key = idempotencyKey(data, "ADJ");

    return v2db.$transaction(async (tx) => {
      const result: unknown = await adjustInventory(tx, serviceScope(scope), {
        batchId,
        locationId,
        mode,
        quantity,
        reason,
        idempotencyKey: key,
      });
      const [transaction, balance, batch, location] = await Promise.all([
        tx.inventoryTransaction.findUnique({
          where: { idempotencyKey: key },
          include: { batch: { include: { material: true } } },
        }),
        tx.batchBalance.findUnique({ where: { batchId_locationId: { batchId, locationId } } }),
        tx.inventoryBatch.findFirst({ where: { id: batchId, storeId: scope.storeId }, include: { material: true } }),
        tx.inventoryLocation.findFirst({ where: { id: locationId, storeId: scope.storeId } }),
      ]);
      const transactionId = transaction?.id ?? pick(result, ["transactionId"]) ?? pick(result, ["id"]) ?? "—";
      const batchNo = transaction?.batch.batchNo ?? batch?.batchNo ?? batchId;
      const material = transaction?.batch.material ?? batch?.material;
      const unit = material?.baseUnit ?? "";
      const onHand = balance?.onHandQty ?? pick(result, ["locationOnHand", "onHandQty", "resultingOnHandQty"]);
      return `库存调整完成：流水 ${transactionId}，批次 ${batchNo}（${material ? `${material.code} ${material.name}` : "物料"}）${mode === "INCREASE" ? "增加" : "减少"} ${quantity} ${unit}，库位 ${location?.code ?? locationId} 调整后实存 ${formatQty(onHand)} ${unit}。`;
    });
  });
}

export async function transferInventoryAction(data: FormData) {
  return run(async () => {
    const scope = await requireV2Store("purchase");
    const batchId = text(data, "batchId");
    const fromLocationId = text(data, "fromLocationId");
    const toLocationId = text(data, "toLocationId");
    if (!batchId || !fromLocationId || !toLocationId) throw new Error("请选择批次、源库位和目标库位");
    if (fromLocationId === toLocationId) throw new Error("源库位和目标库位不能相同");
    const quantity = numeric(data, "quantity", "移库数量");
    const reason = text(data, "reason");
    const key = idempotencyKey(data, "TRF");

    return v2db.$transaction(async (tx) => {
      const result: unknown = await transferInventory(tx, serviceScope(scope), {
        batchId,
        fromLocationId,
        toLocationId,
        quantity,
        reason,
        idempotencyKey: key,
      });
      const [transaction, balanceRows, locationRows, batch] = await Promise.all([
        tx.inventoryTransaction.findUnique({ where: { idempotencyKey: key } }),
        tx.batchBalance.findMany({ where: { batchId, locationId: { in: [fromLocationId, toLocationId] } } }),
        tx.inventoryLocation.findMany({
          where: { storeId: scope.storeId, id: { in: [fromLocationId, toLocationId] } },
          select: { id: true, code: true },
        }),
        tx.inventoryBatch.findFirst({ where: { id: batchId, storeId: scope.storeId }, include: { material: true } }),
      ]);
      const transactionId = transaction?.id ?? pick(result, ["transactionId"]) ?? pick(result, ["id"]) ?? "—";
      const codes = new Map(locationRows.map((location) => [location.id, location.code]));
      const balances = new Map(balanceRows.map((balance) => [balance.locationId, balance]));
      const fromAfter = balances.get(fromLocationId)?.onHandQty ?? pick(result, ["fromOnHand", "fromOnHandQty", "resultingFromOnHandQty"]);
      const toAfter = balances.get(toLocationId)?.onHandQty ?? pick(result, ["toOnHand", "toOnHandQty", "resultingToOnHandQty"]);
      const unit = batch?.material.baseUnit ?? "";
      const materialLabel = batch ? `${batch.material.code} ${batch.material.name}` : "物料";
      const reasonText = reason ? `，原因：${reason}` : "";
      return `库位移库完成：流水 ${transactionId}，批次 ${batch?.batchNo ?? batchId}（${materialLabel}）${quantity} ${unit} 从 ${codes.get(fromLocationId) ?? fromLocationId} 移至 ${codes.get(toLocationId) ?? toLocationId}；源库位实存 ${formatQty(fromAfter)} ${unit}，目标库位实存 ${formatQty(toAfter)} ${unit}${reasonText}。`;
    });
  });
}

export async function createStocktakeAction(data: FormData) {
  return run(async () => {
    const scope = await requireV2Store("purchase");
    const lines: { batchId: string; locationId: string; countedQty: number; reason: string }[] = [];
    for (let index = 0; index < STOCKTAKE_LINE_LIMIT; index += 1) {
      const batchId = text(data, `batchId-${index}`);
      if (!batchId) continue;
      const locationId = text(data, `locationId-${index}`);
      if (!locationId) throw new Error(`第 ${index + 1} 行盘点缺少库位`);
      const countedQty = numeric(data, `countedQty-${index}`, `第 ${index + 1} 行实盘数量`);
      lines.push({ batchId, locationId, countedQty, reason: text(data, `reason-${index}`) });
    }
    if (!lines.length) throw new Error("盘点至少需要一行有效明细（批次、库位、实盘数量）");
    const key = idempotencyKey(data, "STK");

    return v2db.$transaction(async (tx) => {
      const result: unknown = await createStocktakeDraft(tx, serviceScope(scope), { idempotencyKey: key, lines });
      const resultId = stocktakeIdFrom(result);
      const draft = resultId
        ? await tx.stocktake.findFirst({ where: { id: resultId, storeId: scope.storeId }, include: { lines: true } })
        : await tx.stocktake.findFirst({
            where: { storeId: scope.storeId, state: "DRAFT" },
            include: { lines: true },
            orderBy: { createdAt: "desc" },
          });
      const stocktakeId = resultId ?? draft?.id ?? "—";
      return `盘点草稿已创建：盘点单 ${stocktakeId}，共 ${draft?.lines.length ?? lines.length} 行；请核对后点击“确认盘点”，确认前不会调整库存。`;
    });
  });
}

export async function confirmStocktakeAction(data: FormData) {
  return run(async () => {
    const scope = await requireV2Store("purchase");
    const stocktakeId = text(data, "stocktakeId");
    if (!stocktakeId) throw new Error("缺少盘点单编号");

    return v2db.$transaction(async (tx) => {
      const result: unknown = await confirmStocktake(tx, serviceScope(scope), stocktakeId);
      const record = await tx.stocktake.findFirst({
        where: { id: stocktakeId, storeId: scope.storeId },
        include: { lines: true },
      });
      const resultCount = Number(
        pick(result, ["adjustmentCount", "adjustedLineCount", "lineCount"]) ?? NaN
      );
      const adjustedLines = record
        ? record.lines.filter((line) => Number(line.countedQty) !== Number(line.recordedQty)).length
        : 0;
      const adjustmentCount = Number.isFinite(resultCount) ? resultCount : adjustedLines;
      if (asRecord(result).alreadyConfirmed === true) {
        return `盘点单 ${stocktakeId} 此前已确认，本次未重复调整库存（已调整 ${adjustmentCount} 行）。`;
      }
      return `盘点已确认：盘点单 ${stocktakeId}，调整 ${adjustmentCount} 行，库存已按实盘数更新并生成 ADJUSTMENT 流水。`;
    });
  });
}

export async function recordLossAction(data: FormData) {
  return run(async () => {
    const scope = await requireV2Store("purchase");
    const batchId = text(data, "batchId");
    const locationId = text(data, "locationId");
    if (!batchId || !locationId) throw new Error("请选择损耗批次和库位");
    const quantity = numeric(data, "quantity", "损耗数量");
    const reasonValue = text(data, "reason");
    if (!LOSS_REASON_OPTIONS.includes(reasonValue as LossReason)) throw new Error("请选择有效的损耗原因");
    const reason = reasonValue as LossReason;
    const note = text(data, "note");
    const rawDate = text(data, "occurredAt");
    const occurredAt = rawDate ? new Date(rawDate) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new Error("损耗发生时间格式无效");
    const key = idempotencyKey(data, "LOSS");

    return v2db.$transaction(async (tx) => {
      const result: unknown = await recordLoss(tx, serviceScope(scope), {
        batchId,
        locationId,
        quantity,
        reason,
        note,
        occurredAt,
        idempotencyKey: key,
      });
      const lossId = lossRecordIdFrom(result);
      const [record, transaction, balance, batch, location] = await Promise.all([
        lossId ? tx.lossRecord.findFirst({ where: { id: lossId, storeId: scope.storeId } }) : Promise.resolve(null),
        tx.inventoryTransaction.findUnique({ where: { idempotencyKey: key } }),
        tx.batchBalance.findUnique({ where: { batchId_locationId: { batchId, locationId } } }),
        tx.inventoryBatch.findFirst({ where: { id: batchId, storeId: scope.storeId }, include: { material: true } }),
        tx.inventoryLocation.findFirst({ where: { id: locationId, storeId: scope.storeId }, select: { code: true } }),
      ]);
      const unit = batch?.material.baseUnit ?? "";
      const materialLabel = batch ? `${batch.material.code} ${batch.material.name}` : "物料";
      return `损耗已登记：损耗单 ${lossId ?? record?.id ?? "—"}，流水 ${transaction?.id ?? "—"}，批次 ${batch?.batchNo ?? batchId}（${materialLabel}）${quantity} ${unit}，库位 ${location?.code ?? locationId}，原因 ${LOSS_REASON_LABELS[reason]}；登记后库位实存 ${formatQty(balance?.onHandQty)} ${unit}。`;
    });
  });
}
