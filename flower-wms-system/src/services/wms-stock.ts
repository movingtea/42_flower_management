import type { Prisma } from "@/generated/prisma/client";
import { StockLogType } from "@/generated/prisma/enums";
import type { OperatorContext } from "@/lib/operator-context";
import { assertStockMutationOperatorMatches } from "@/lib/stock-mutation-auth";
import { prisma } from "@/lib/prisma";
import { generateBatchNo } from "@/utils/batch-no";
import { generateUniqueSku } from "@/utils/skuGenerator";
import {
  resolveBatchExpiresAt,
  resolveStockInQuantities,
} from "@/lib/stock-in-calc";

export {
  resolveBatchExpiresAt,
  resolveStockInQuantities,
} from "@/lib/stock-in-calc";

export type StockInPayload = {
  flowerWikiId: string;
  /** 到货束数 */
  bundleCount: number;
  /** 每束包含的支数 */
  stemsPerBundle: number;
  /** 每束采购价（元） */
  costPricePerBundle: number;
  /** 本批次保质期（天）；未填则使用花材母表默认值 */
  shelfLifeDays?: number;
  supplier?: string;
  operator: OperatorContext;
};

export type StockLossPayload = {
  flowerWikiId: string;
  stockBatchId: string;
  lossQuantity: number;
  reason: string;
  operator: OperatorContext;
};

export type BatchPipelineRow = {
  batchId: string;
  batchNo: string | null;
  materialId: string;
  materialName: string;
  flowerWikiId: string | null;
  inboundAt: string;
  createdAt: string;
  remainingQty: number;
  originalQty: number;
  unitCost: string;
  expiresAt: string | null;
  supplier: string | null;
  unit: string;
};

export type WikiBatchOption = {
  batchId: string;
  batchNo: string | null;
  createdAt: string;
  remainingQty: number;
  unitCost: string;
  supplier: string | null;
  unit: string;
};

export type StockLossHistoryRow = {
  id: string;
  createdAt: string;
  batchId: string;
  batchNo: string | null;
  batchCreatedAt: string;
  lossQuantity: number;
  reason: string;
  operator: string | null;
};

type Tx = Prisma.TransactionClient;

function parseFlowerWikiId(raw: unknown): string {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) throw new Error("flowerWikiId 不能为空");
  return id;
}

function parseStockBatchId(raw: unknown): string {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) throw new Error("stockBatchId 不能为空");
  return id;
}

function parsePositiveInt(raw: unknown, label: string): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label}须为正整数`);
  }
  return n;
}

function parseCostPricePerBundle(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("每束进货价无效");
  }
  return n;
}

function parseOptionalShelfLifeDays(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  return parsePositiveInt(raw, "保质期");
}

function parseReason(raw: unknown): string {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) throw new Error("损耗原因不能为空");
  return reason;
}

export function attachOperatorToStockLossPayload(
  base: Omit<StockLossPayload, "operator">,
  operator: OperatorContext
): StockLossPayload {
  return { ...base, operator };
}

export function attachOperatorToStockInPayload(
  base: Omit<StockInPayload, "operator">,
  operator: OperatorContext
): StockInPayload {
  return { ...base, operator };
}

export function parseStockInBody(raw: unknown): Omit<StockInPayload, "operator"> {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const body = raw as Record<string, unknown>;
  return {
    flowerWikiId: parseFlowerWikiId(body.flowerWikiId),
    bundleCount: parsePositiveInt(body.bundleCount, "到货束数"),
    stemsPerBundle: parsePositiveInt(body.stemsPerBundle, "每束支数"),
    costPricePerBundle: parseCostPricePerBundle(body.costPricePerBundle),
    shelfLifeDays: parseOptionalShelfLifeDays(body.shelfLifeDays),
    supplier:
      typeof body.supplier === "string" ? body.supplier.trim() || undefined : undefined,
  };
}

export function parseStockLossBody(
  raw: unknown
): Omit<StockLossPayload, "operator"> {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const body = raw as Record<string, unknown>;
  return {
    flowerWikiId: parseFlowerWikiId(body.flowerWikiId),
    stockBatchId: parseStockBatchId(body.stockBatchId),
    lossQuantity: parsePositiveInt(body.lossQuantity, "损耗数量"),
    reason: parseReason(body.reason),
  };
}

async function assertWikiExists(tx: Tx, flowerWikiId: string) {
  const wiki = await tx.flowerWiki.findUnique({
    where: { id: flowerWikiId },
    select: { id: true, chineseName: true, defaultShelfLifeDays: true },
  });
  if (!wiki) throw new Error("花材母表记录不存在");
  return wiki;
}

async function resolveOrCreateMaterial(tx: Tx, flowerWikiId: string) {
  const wiki = await assertWikiExists(tx, flowerWikiId);

  let material = await tx.material.findFirst({
    where: { wikiId: flowerWikiId },
  });

  if (!material) {
    const materialCode = await generateUniqueSku("material", tx);
    material = await tx.material.create({
      data: {
        materialCode,
        name: wiki.chineseName,
        unit: "支",
        wikiId: flowerWikiId,
      },
    });
  }

  return material;
}

/** 原料到货入库：每批独立 Batch + INBOUND 流水 */
export async function runStockInTransaction(payload: StockInPayload) {
  const operator = await assertStockMutationOperatorMatches(
    "wms:write",
    payload.operator
  );

  return prisma.$transaction(async (tx) => {
    const wiki = await assertWikiExists(tx, payload.flowerWikiId);
    const material = await resolveOrCreateMaterial(tx, payload.flowerWikiId);
    const batchNo = await generateBatchNo(tx);
    const now = new Date();
    const { totalStems, unitCostPerStem } = resolveStockInQuantities(payload);
    const shelfLifeDays =
      payload.shelfLifeDays ?? wiki.defaultShelfLifeDays ?? null;
    const expiresAt = resolveBatchExpiresAt(now, shelfLifeDays);
    const inboundRemark = `原料到货入库（${payload.bundleCount}束×${payload.stemsPerBundle}支/束）`;

    const batch = await tx.batch.create({
      data: {
        materialId: material.id,
        batchNo,
        inboundAt: now,
        originalQty: totalStems,
        remainingQty: totalStems,
        unitCost: unitCostPerStem,
        expiresAt,
        supplier: payload.supplier ?? null,
      },
    });

    await tx.stockLog.create({
      data: {
        materialId: material.id,
        batchId: batch.id,
        type: StockLogType.INBOUND,
        delta: totalStems,
        quantity: totalStems,
        remark: inboundRemark,
        operator: operator.operatorLabel,
        operatorStaffId: operator.operatorStaffId,
      },
    });

    return { material, batch, totalStems, shelfLifeDays, expiresAt };
  });
}

/** 指定批次精准扣减（非 FIFO，由仓管手动选定批次） */
export async function runStockLossTransaction(payload: StockLossPayload) {
  const operator = await assertStockMutationOperatorMatches(
    "wms:write",
    payload.operator
  );

  return prisma.$transaction(async (tx) => {
    await assertWikiExists(tx, payload.flowerWikiId);

    const batch = await tx.batch.findUnique({
      where: { id: payload.stockBatchId },
      include: {
        material: { select: { id: true, name: true, wikiId: true } },
      },
    });

    if (!batch) {
      throw new Error("指定批次不存在");
    }

    if (batch.material.wikiId !== payload.flowerWikiId) {
      throw new Error("所选批次与花材不匹配，请重新选择");
    }

    if (batch.remainingQty < payload.lossQuantity) {
      throw new Error("报损数量超出该批次可用库存");
    }

    const updated = await tx.batch.updateMany({
      where: {
        id: batch.id,
        remainingQty: { gte: payload.lossQuantity },
      },
      data: { remainingQty: { decrement: payload.lossQuantity } },
    });

    if (updated.count !== 1) {
      throw new Error("批次库存并发冲突，请刷新后重试");
    }

    const stockLog = await tx.stockLog.create({
      data: {
        materialId: batch.materialId,
        batchId: batch.id,
        type: StockLogType.WASTAGE_OUT,
        delta: -payload.lossQuantity,
        quantity: payload.lossQuantity,
        wastageReason: payload.reason,
        remark: payload.reason,
        operator: operator.operatorLabel,
        operatorStaffId: operator.operatorStaffId,
      },
    });

    const lossRecord = await tx.stockLossRecord.create({
      data: {
        flowerWikiId: payload.flowerWikiId,
        batchId: batch.id,
        lossQuantity: payload.lossQuantity,
        reason: payload.reason,
        operator: operator.operatorLabel,
        operatorStaffId: operator.operatorStaffId,
        stockLogId: stockLog.id,
      },
    });

    return {
      materialId: batch.materialId,
      materialName: batch.material.name,
      batchId: batch.id,
      batchNo: batch.batchNo,
      lossQuantity: payload.lossQuantity,
      remainingQty: batch.remainingQty - payload.lossQuantity,
      lossRecordId: lossRecord.id,
    };
  });
}

/** 某花材下可用批次（报损批次选择器） */
export async function listWikiAvailableBatches(
  flowerWikiId: string
): Promise<WikiBatchOption[]> {
  const material = await prisma.material.findFirst({
    where: { wikiId: flowerWikiId },
    select: { id: true, unit: true },
  });
  if (!material) return [];

  const batches = await prisma.batch.findMany({
    where: {
      materialId: material.id,
      remainingQty: { gt: 0 },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      batchNo: true,
      createdAt: true,
      remainingQty: true,
      unitCost: true,
      supplier: true,
    },
  });

  return batches.map((b) => ({
    batchId: b.id,
    batchNo: b.batchNo,
    createdAt: b.createdAt.toISOString(),
    remainingQty: b.remainingQty,
    unitCost: b.unitCost.toString(),
    supplier: b.supplier,
    unit: material.unit,
  }));
}

/** 损耗历史（按母表 ID） */
export async function listStockLossHistory(
  flowerWikiId: string
): Promise<StockLossHistoryRow[]> {
  const rows = await prisma.stockLossRecord.findMany({
    where: { flowerWikiId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      batch: { select: { batchNo: true, createdAt: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    batchId: r.batchId,
    batchNo: r.batch.batchNo,
    batchCreatedAt: r.batch.createdAt.toISOString(),
    lossQuantity: r.lossQuantity,
    reason: r.reason,
    operator: r.operator,
  }));
}

/** 损耗历史（按原材料 ID，库存详情页） */
export async function listStockLossHistoryByMaterialId(
  materialId: string
): Promise<StockLossHistoryRow[]> {
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { wikiId: true },
  });
  if (!material?.wikiId) return [];
  return listStockLossHistory(material.wikiId);
}

/** 大仓批次库存流水线（仅 remainingQty > 0） */
export async function listActiveBatchPipeline(): Promise<BatchPipelineRow[]> {
  const batches = await prisma.batch.findMany({
    where: { remainingQty: { gt: 0 } },
    orderBy: [{ materialId: "asc" }, { createdAt: "asc" }],
    include: {
      material: {
        select: { name: true, unit: true, wikiId: true },
      },
    },
  });

  return batches.map((b) => ({
    batchId: b.id,
    batchNo: b.batchNo,
    materialId: b.materialId,
    materialName: b.material.name,
    flowerWikiId: b.material.wikiId,
    inboundAt: b.inboundAt.toISOString(),
    createdAt: b.createdAt.toISOString(),
    remainingQty: b.remainingQty,
    originalQty: b.originalQty,
    unitCost: b.unitCost.toString(),
    expiresAt: b.expiresAt?.toISOString() ?? null,
    supplier: b.supplier,
    unit: b.material.unit,
  }));
}
