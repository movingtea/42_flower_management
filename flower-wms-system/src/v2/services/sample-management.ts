import { LocationKind, Prisma, ReservationState, SampleState } from "../../generated/prisma-v2/client";
import { storageConfigToImageUrlEnv } from "@/lib/storage/config";
import { generateSampleCode } from "../domain/identifiers";
import { normalizeV2ImageKey } from "../domain/media";
import { calculateSamplePricing, type SamplePricingResult } from "../domain/sample-pricing";
import { assertMaterialQuantity } from "../domain/stock-planning";
import { applyProcurementLoss } from "../domain/procurement-loss";

export type SampleScope = { tenantId: string; storeId: string; actorStaffId: string };

export type SampleMaterialInput = {
  materialId: string;
  quantity: number;
};

export type SaveSampleInput = {
  id?: string;
  name: string;
  description?: string | null;
  imageKey?: string | null;
  priority?: number;
  state?: SampleState;
  targetMarginRate?: number | null;
  /** Default photography deadline inherited by new plan items. */
  photoDueAt?: Date | null;
  /** Default retention deadline inherited by new plan items. */
  retentionUntil?: Date | null;
  materials: SampleMaterialInput[];
};

export type SaveSampleResult = {
  id: string;
  code: string;
  state: SampleState;
  versionNo: number;
};

export type SampleCostLine = {
  materialId: string;
  materialCode: string;
  materialName: string;
  kind: string;
  baseUnit: string;
  quantity: number;
  unitCost: number;
  lineCost: number;
  availableQty: number;
  reusableRate: number;
  unitCostSource: "BATCH" | "STANDARD" | "NONE";
};

export type SampleCostEstimate = SamplePricingResult & {
  sampleId: string;
  sampleName: string;
  sampleState: SampleState;
  lines: SampleCostLine[];
  packagingCost: number;
  materialCost: number;
};

type AuditSnapshot = Prisma.InputJsonObject;

const SAMPLE_VERSION_ACTIONS = ["SAMPLE_CREATED", "SAMPLE_UPDATED"] as const;

function assertScope(scope: SampleScope): void {
  if (!scope?.tenantId?.trim() || !scope.storeId?.trim() || !scope.actorStaffId?.trim()) {
    throw new Error("缺少租户、门店或操作员工信息");
  }
}

function normalizedName(value: string): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new Error("样品名称必填");
  if (name.length > 100) throw new Error("样品名称不能超过 100 个字符");
  return name;
}

function optionalText(value: string | null | undefined, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
  return trimmed;
}

function normalizedImageKey(value: string | null | undefined): string | null {
  return normalizeV2ImageKey(value, storageConfigToImageUrlEnv());
}

function normalizeMargin(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("目标毛利率必须大于等于 0 且小于 1");
  }
  if (Math.abs(value * 10_000 - Math.round(value * 10_000)) > 1e-8) {
    throw new Error("目标毛利率最多保留四位小数");
  }
  return value;
}

function normalizePriority(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) throw new Error("样品优先级必须为非负整数");
  return value;
}

function optionalDate(value: Date | null | undefined, label: string): Date | null {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label}无效`);
  }
  return value;
}

async function recordAudit(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  action: string,
  entityType: string,
  entityId: string,
  beforeSnapshot?: AuditSnapshot,
  afterSnapshot?: AuditSnapshot,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action,
      entityType,
      entityId,
      beforeSnapshot,
      afterSnapshot,
    },
  });
}

async function lockSample(tx: Prisma.TransactionClient, sampleId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Sample" WHERE id = ${sampleId} FOR UPDATE`;
}

type StoredSample = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  state: SampleState;
  imageKey: string | null;
  description: string | null;
  priority: number;
  targetMarginRate: Prisma.Decimal | null;
  photoDueAt: Date | null;
  retentionUntil: Date | null;
  materials: {
    id: string;
    materialId: string;
    quantity: Prisma.Decimal;
    material: { code: string; name: string; baseUnit: string; kind: string };
  }[];
};

async function loadSample(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  sampleId: string,
): Promise<StoredSample> {
  const sample = await tx.sample.findFirst({
    where: { id: sampleId, tenantId: scope.tenantId },
    include: {
      materials: {
        include: {
          material: { select: { code: true, name: true, baseUnit: true, kind: true } },
        },
        orderBy: { material: { code: "asc" } },
      },
    },
  });
  if (!sample) throw new Error("样品不存在或不属于当前租户");
  return sample as StoredSample;
}

function materialSnapshot(materials: StoredSample["materials"]): Prisma.InputJsonArray {
  return materials.map((line) => ({
    materialId: line.materialId,
    materialCode: line.material.code,
    materialName: line.material.name,
    quantity: Number(line.quantity),
    baseUnit: line.material.baseUnit,
  })) as Prisma.InputJsonArray;
}

function sampleSnapshot(sample: StoredSample): AuditSnapshot {
  return {
    code: sample.code,
    name: sample.name,
    state: sample.state,
    description: sample.description,
    imageKey: sample.imageKey,
    priority: sample.priority,
    targetMarginRate: sample.targetMarginRate === null ? null : Number(sample.targetMarginRate),
    photoDueAt: sample.photoDueAt?.toISOString() ?? null,
    retentionUntil: sample.retentionUntil?.toISOString() ?? null,
    materials: materialSnapshot(sample.materials),
  };
}

async function nextVersionNo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sampleId: string,
): Promise<number> {
  const count = await tx.auditEvent.count({
    where: {
      tenantId,
      entityType: "Sample",
      entityId: sampleId,
      action: { in: [...SAMPLE_VERSION_ACTIONS] },
    },
  });
  return count + 1;
}

async function validateMaterials(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  materials: SampleMaterialInput[],
): Promise<{ materialId: string; quantity: number }[]> {
  if (!Array.isArray(materials)) throw new Error("样品物料清单无效");
  if (materials.length === 0) return [];
  const ids = materials.map((line) => {
    const materialId = typeof line?.materialId === "string" ? line.materialId.trim() : "";
    if (!materialId) throw new Error("样品物料不能为空");
    return materialId;
  });
  if (new Set(ids).size !== ids.length) throw new Error("同一物料不能在样品中重复添加");
  const stored = await tx.material.findMany({
    where: { id: { in: ids }, tenantId: scope.tenantId },
    select: { id: true, name: true, quantityScale: true, active: true },
  });
  if (stored.length !== ids.length) {
    throw new Error("样品物料不存在或不属于当前租户");
  }
  return materials.map((line, index) => {
    const materialId = ids[index]!;
    const material = stored.find((item) => item.id === materialId)!;
    const quantity = line?.quantity;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`${material.name} 的用量必须大于零`);
    }
    try {
      assertMaterialQuantity(quantity, material.quantityScale);
    } catch {
      throw new Error(`${material.name} 的用量不符合物料计量精度`);
    }
    return { materialId, quantity };
  });
}

function publicState(value: SampleState | undefined, fallback: SampleState): SampleState {
  if (value === undefined) return fallback;
  if (!Object.values(SampleState).includes(value)) throw new Error("样品状态无效");
  return value;
}

export async function saveSample(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  input: SaveSampleInput,
): Promise<SaveSampleResult> {
  assertScope(scope);
  const name = normalizedName(input.name);
  const description = optionalText(input.description, 2000, "样品说明");
  const imageKey = input.imageKey === undefined ? undefined : normalizedImageKey(input.imageKey);
  const priority = normalizePriority(input.priority);
  const targetMarginRate = normalizeMargin(input.targetMarginRate);
  const photoDueAt = optionalDate(input.photoDueAt, "拍摄截止时间");
  const retentionUntil = optionalDate(input.retentionUntil, "留样截止时间");
  const materials = await validateMaterials(tx, scope, input.materials ?? []);
  const requestedState = publicState(input.state, SampleState.DRAFT);
  if (requestedState === SampleState.READY && materials.length === 0) {
    throw new Error("标记样品完成前至少需要一项花材");
  }

  if (!input.id) {
    const created = await tx.sample.create({
      data: {
        tenantId: scope.tenantId,
        code: generateSampleCode(new Date(), crypto.randomUUID()),
        name,
        state: requestedState,
        description,
        imageKey: imageKey ?? null,
        priority,
        targetMarginRate,
        photoDueAt,
        retentionUntil,
        materials: { create: materials },
      },
      select: { id: true, code: true, state: true },
    });
    const versionNo = await nextVersionNo(tx, scope.tenantId, created.id);
    await recordAudit(
      tx,
      scope,
      "SAMPLE_CREATED",
      "Sample",
      created.id,
      undefined,
      {
        ...sampleSnapshot({
          id: created.id,
          tenantId: scope.tenantId,
          code: created.code,
          name,
          state: created.state,
          description,
          imageKey: imageKey ?? null,
          priority,
          targetMarginRate: targetMarginRate === null ? null : new Prisma.Decimal(targetMarginRate),
          photoDueAt,
          retentionUntil,
          materials: [],
        }),
        versionNo,
        materials,
      },
    );
    return { id: created.id, code: created.code, state: created.state, versionNo };
  }

  const sampleId = input.id.trim();
  if (!sampleId) throw new Error("样品标识不能为空");
  await lockSample(tx, sampleId);
  const current = await loadSample(tx, scope, sampleId);
  if (current.state === SampleState.ARCHIVED && requestedState !== SampleState.ARCHIVED) {
    throw new Error("已归档样品不能直接修改，请复制为新样品");
  }
  const versionNo = await nextVersionNo(tx, scope.tenantId, sampleId);

  const updated = await tx.sample.update({
    where: { id: sampleId },
    data: {
      name,
      state: requestedState,
      description,
      priority,
      targetMarginRate,
      photoDueAt,
      retentionUntil,
      ...(imageKey === undefined ? {} : { imageKey }),
      materials: {
        deleteMany: {},
        create: materials,
      },
    },
    select: { id: true, code: true, state: true },
  });
  await recordAudit(
    tx,
    scope,
    "SAMPLE_UPDATED",
    "Sample",
    updated.id,
    sampleSnapshot(current),
    {
      code: updated.code,
      name,
      state: updated.state,
      description,
      imageKey: imageKey === undefined ? current.imageKey : imageKey,
      priority,
      targetMarginRate,
      photoDueAt: photoDueAt?.toISOString() ?? null,
      retentionUntil: retentionUntil?.toISOString() ?? null,
      materials,
      versionNo,
    },
  );
  return { id: updated.id, code: updated.code, state: updated.state, versionNo };
}

export async function copySample(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  sampleId: string,
): Promise<SaveSampleResult> {
  assertScope(scope);
  const source = await loadSample(tx, scope, sampleId);
  const created = await tx.sample.create({
    data: {
      tenantId: scope.tenantId,
      code: generateSampleCode(new Date(), crypto.randomUUID()),
      name: optionalText(`${source.name}（副本）`, 100, "样品名称")!,
      state: SampleState.DRAFT,
      description: source.description,
      imageKey: source.imageKey,
      priority: source.priority,
      targetMarginRate: source.targetMarginRate,
      photoDueAt: source.photoDueAt,
      retentionUntil: source.retentionUntil,
      materials: {
        create: source.materials.map((line) => ({
          materialId: line.materialId,
          quantity: line.quantity,
        })),
      },
    },
    select: { id: true, code: true, state: true },
  });
  const versionNo = await nextVersionNo(tx, scope.tenantId, created.id);
  await recordAudit(tx, scope, "SAMPLE_COPIED", "Sample", created.id, undefined, {
    sourceSampleId: source.id,
    sourceCode: source.code,
    code: created.code,
    name: optionalText(`${source.name}（副本）`, 100, "样品名称"),
    versionNo,
    materials: source.materials.map((line) => ({
      materialId: line.materialId,
      quantity: Number(line.quantity),
    })),
  });
  return { id: created.id, code: created.code, state: created.state, versionNo };
}

export async function setSampleState(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  sampleId: string,
  state: SampleState,
): Promise<SaveSampleResult> {
  assertScope(scope);
  const sampleIdValue = typeof sampleId === "string" ? sampleId.trim() : "";
  if (!sampleIdValue) throw new Error("样品标识不能为空");
  if (!Object.values(SampleState).includes(state)) throw new Error("样品状态无效");
  await lockSample(tx, sampleIdValue);
  const current = await loadSample(tx, scope, sampleIdValue);
  if (current.state === state) {
    return { id: current.id, code: current.code, state, versionNo: 0 };
  }
  if (current.state === SampleState.ARCHIVED && state !== SampleState.ARCHIVED) {
    throw new Error("已归档样品不能恢复，请复制为新样品");
  }
  if (state === SampleState.READY && current.materials.length === 0) {
    throw new Error("标记样品完成前至少需要一项花材");
  }
  const updated = await tx.sample.update({
    where: { id: sampleIdValue },
    data: { state },
    select: { id: true, code: true, state: true },
  });
  await recordAudit(tx, scope, "SAMPLE_STATE_CHANGED", "Sample", updated.id, {
    state: current.state,
  }, {
    state,
  });
  return { id: updated.id, code: updated.code, state: updated.state, versionNo: 0 };
}

async function latestUnitCost(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  materialId: string,
): Promise<{ unitCost: number; source: SampleCostLine["unitCostSource"] }> {
  const batch = await tx.inventoryBatch.findFirst({
    where: { storeId: scope.storeId, materialId },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { unitCost: true, lossAdjustedUnitCost: true, channelLossRate: true },
  });
  if (batch) {
    const unitCost = batch.lossAdjustedUnitCost !== null
      ? Number(batch.lossAdjustedUnitCost)
      : batch.channelLossRate !== null
        ? applyProcurementLoss({
            quantity: 1,
            unitCost: Number(batch.unitCost),
            lossRate: Number(batch.channelLossRate),
          }).lossAdjustedUnitCost
        : Number(batch.unitCost);
    return { unitCost, source: "BATCH" };
  }
  const material = await tx.material.findFirst({
    where: { id: materialId, tenantId: scope.tenantId },
    select: { standardUnitCost: true, defaultLossRate: true },
  });
  if (material?.standardUnitCost !== null && material?.standardUnitCost !== undefined) {
    const unitCost = applyProcurementLoss({
      quantity: 1,
      unitCost: Number(material.standardUnitCost),
      lossRate: material.defaultLossRate === null ? 0 : Number(material.defaultLossRate),
    }).lossAdjustedUnitCost;
    return { unitCost, source: "STANDARD" };
  }
  return { unitCost: 0, source: "NONE" };
}

async function availableQuantities(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  materialIds: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (materialIds.length === 0) return result;
  const batches = await tx.inventoryBatch.findMany({
    where: { storeId: scope.storeId, materialId: { in: [...materialIds] } },
    select: {
      id: true,
      materialId: true,
      balances: {
        select: {
          onHandQty: true,
          frozenQty: true,
          location: { select: { kind: true } },
        },
      },
    },
  });
  const batchIds = batches.map((batch) => batch.id);
  const orders = batchIds.length === 0
    ? []
    : await tx.inventoryReservation.groupBy({
        by: ["batchId"],
        where: { batchId: { in: batchIds }, state: ReservationState.ACTIVE },
        _sum: { quantity: true },
      });
  const samples = batchIds.length === 0
    ? []
    : await tx.sampleInventoryReservation.groupBy({
        by: ["batchId"],
        where: { batchId: { in: batchIds }, state: ReservationState.ACTIVE },
        _sum: { quantity: true },
      });
  const orderByBatch = new Map(orders.map((row) => [row.batchId, Number(row._sum.quantity ?? 0)]));
  const sampleByBatch = new Map(samples.map((row) => [row.batchId, Number(row._sum.quantity ?? 0)]));
  for (const materialId of materialIds) {
    let available = 0;
    for (const batch of batches.filter((row) => row.materialId === materialId)) {
      const warehouseBalances = batch.balances.filter(
        (balance) => balance.location.kind === LocationKind.WAREHOUSE,
      );
      const onHand = warehouseBalances.reduce((sum, row) => sum + Number(row.onHandQty), 0);
      const frozen = warehouseBalances.reduce((sum, row) => sum + Number(row.frozenQty), 0);
      available += Math.max(
        0,
        onHand - frozen
          - (orderByBatch.get(batch.id) ?? 0)
          - (sampleByBatch.get(batch.id) ?? 0),
      );
    }
    result.set(materialId, Math.round((available + 1e-9) * 1000) / 1000);
  }
  return result;
}

export async function estimateSampleCost(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  sampleId: string,
  options: { laborCost?: number; targetMarginRate?: number | null } = {},
): Promise<SampleCostEstimate> {
  assertScope(scope);
  const sample = await loadSample(tx, scope, sampleId);
  const materialIds = sample.materials.map((line) => line.materialId);
  const availability = await availableQuantities(tx, scope, materialIds);
  const storedMaterials = await tx.material.findMany({
    where: { id: { in: materialIds }, tenantId: scope.tenantId },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      baseUnit: true,
      standardUsableRate: true,
      optimisticUsableRate: true,
    },
  });
  const lines: SampleCostLine[] = [];
  for (const line of sample.materials) {
    const material = storedMaterials.find((row) => row.id === line.materialId);
    if (!material) throw new Error("样品物料不存在或不属于当前租户");
    const cost = await latestUnitCost(tx, scope, line.materialId);
    const quantity = Number(line.quantity);
    lines.push({
      materialId: material.id,
      materialCode: material.code,
      materialName: material.name,
      kind: material.kind,
      baseUnit: material.baseUnit,
      quantity,
      unitCost: cost.unitCost,
      lineCost: Math.round((quantity * cost.unitCost + 1e-9) * 100) / 100,
      availableQty: availability.get(material.id) ?? 0,
      reusableRate: Number(material.standardUsableRate ?? material.optimisticUsableRate ?? 0),
      unitCostSource: cost.source,
    });
  }
  const materialCost = lines
    .filter((line) => line.kind !== "PACKAGING" && line.kind !== "CONSUMABLE")
    .reduce((sum, line) => sum + line.lineCost, 0);
  const packagingCost = lines
    .filter((line) => line.kind === "PACKAGING" || line.kind === "CONSUMABLE")
    .reduce((sum, line) => sum + line.lineCost, 0);
  const margin = options.targetMarginRate === undefined
    ? (sample.targetMarginRate === null ? null : Number(sample.targetMarginRate))
    : options.targetMarginRate;
  const pricing = calculateSamplePricing({
    materialCost,
    packagingCost,
    laborCost: options.laborCost ?? 0,
    targetMarginRate: margin,
  });
  return {
    ...pricing,
    sampleId: sample.id,
    sampleName: sample.name,
    sampleState: sample.state,
    lines,
    materialCost,
    packagingCost,
  };
}

export async function listSampleVersionHistory(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  sampleId: string,
  take = 10,
) {
  return tx.auditEvent.findMany({
    where: {
      tenantId: scope.tenantId,
      entityType: "Sample",
      entityId: sampleId,
      action: { in: [...SAMPLE_VERSION_ACTIONS, "SAMPLE_STATE_CHANGED", "SAMPLE_COPIED", "SAMPLE_CONVERTED_TO_SKU", "SAMPLE_MATERIAL_SUBSTITUTED"] },
    },
    orderBy: { occurredAt: "desc" },
    take,
  });
}

