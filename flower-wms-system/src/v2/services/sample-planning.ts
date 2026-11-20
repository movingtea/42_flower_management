import { randomUUID } from "node:crypto";
import {
  LocationKind,
  LossReason,
  Prisma,
  ReservationState,
  SamplePlanCandidateState,
  SamplePlanState,
  SampleState,
  TransactionKind,
} from "../../generated/prisma-v2/client";
import {
  calculateSamplePlan,
  type SamplePlanCalculationResult,
  type SamplePlanningMaterial,
  type SamplePlanningSample,
} from "../domain/sample-planning";
import { assertMaterialQuantity } from "../domain/stock-planning";
import {
  lockBatchBalances,
  lockBatchRow,
  lockStoreRow,
} from "./inventory-operations";
import { getMaterialAvailableQuantities } from "./material-availability";

export type SamplePlanScope = { tenantId: string; storeId: string; actorStaffId: string };

export type SamplePlanItemInput = {
  sampleId: string;
  quantity: number;
  mandatory: boolean;
  sequenceNo?: number | null;
};

export type SaveSamplePlanInput = {
  id?: string;
  name: string;
  items: SamplePlanItemInput[];
};

export type SaveSamplePlanResult = { id: string; name: string; state: SamplePlanState };

export type SamplePlanRunSummary = {
  id: string;
  rank: number;
  requestedSampleCount: number;
  independentCost: number;
  totalCost: number;
  estimatedSaving: number;
  reuseRate: number;
  stepCount: number;
  purchaseQty: number;
  createdAt: Date;
  selected: boolean;
};

export type CalculateSamplePlanResult = {
  planId: string;
  calculationGroupId: string;
  warnings: string[];
  runs: SamplePlanRunSummary[];
};

export type ApproveSamplePlanResult = {
  executionId: string;
  reservedQty: number;
  shortageQty: number;
};

export type SamplePlanStepActualInput = {
  materialId: string;
  usedQty: number;
  reusableQty?: number;
};

export type CompleteSamplePlanStepInput = {
  materials: SamplePlanStepActualInput[];
  disassemble: boolean;
  lossReason?: string | null;
};

export type SamplePlanMaterialResolutionInput = {
  batchId: string;
  returnQty: number;
  keepQty?: number;
  lossQty: number;
  reverified?: boolean;
  usableUntil?: Date | null;
};

export type PauseSamplePlanInput = {
  resolutions?: SamplePlanMaterialResolutionInput[];
};

export type CancelSamplePlanInput = {
  reason: string;
  resolutions?: SamplePlanMaterialResolutionInput[];
};

const EPSILON = 1e-8;

function assertScope(scope: SamplePlanScope): void {
  if (!scope?.tenantId?.trim() || !scope.storeId?.trim() || !scope.actorStaffId?.trim()) {
    throw new Error("缺少租户、门店或操作员工信息");
  }
}

function decimal(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}必须为非负有限数`);
  return value;
}

function roundQty(value: number): number {
  return Math.round((value + EPSILON) * 1000) / 1000;
}

function roundMoney(value: number): number {
  return Math.round((value + EPSILON) * 100) / 100;
}

function normalizedName(value: string): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new Error("打样计划名称必填");
  if (name.length > 100) throw new Error("打样计划名称不能超过 100 个字符");
  return name;
}

function normalizeItems(items: readonly SamplePlanItemInput[]): SamplePlanItemInput[] {
  if (!Array.isArray(items) || items.length === 0) throw new Error("打样计划至少需要一个样品");
  const ids = items.map((item) => {
    const sampleId = typeof item?.sampleId === "string" ? item.sampleId.trim() : "";
    if (!sampleId) throw new Error("打样样品不能为空");
    return sampleId;
  });
  if (new Set(ids).size !== ids.length) throw new Error("同一样品不能在计划中重复");
  if (!items.some((item) => item.mandatory)) throw new Error("打样计划至少需要一个必选样品");
  const sequences = new Set<number>();
  return items.map((item, index) => {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("样品数量必须为正整数");
    }
    const sequenceNo = item.sequenceNo === null || item.sequenceNo === undefined
      ? index + 1
      : item.sequenceNo;
    if (!Number.isInteger(sequenceNo) || sequenceNo <= 0) {
      throw new Error("制作顺序必须为正整数");
    }
    if (sequences.has(sequenceNo)) throw new Error("制作顺序不能重复");
    sequences.add(sequenceNo);
    return {
      sampleId: ids[index]!,
      quantity: item.quantity,
      mandatory: Boolean(item.mandatory),
      sequenceNo,
    };
  });
}

async function recordAudit(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  action: string,
  entityType: string,
  entityId: string,
  beforeSnapshot?: Prisma.InputJsonValue,
  afterSnapshot?: Prisma.InputJsonValue,
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

async function lockPlan(tx: Prisma.TransactionClient, planId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "SamplePlan" WHERE id = ${planId} FOR UPDATE`;
}

async function loadPlan(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
) {
  const plan = await tx.samplePlan.findFirst({
    where: { id: planId, tenantId: scope.tenantId, storeId: scope.storeId },
    include: {
      items: { include: { sample: { include: { materials: true } } }, orderBy: { sequenceNo: "asc" } },
      executions: { select: { id: true, startedAt: true, completedAt: true, cancelledAt: true } },
      runs: { orderBy: { runNo: "desc" }, take: 1 },
    },
  });
  if (!plan) throw new Error("打样计划不存在或不属于当前门店");
  return plan;
}

async function loadMaterialCosts(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  materialIds: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (materialIds.length === 0) return result;
  const materials = await tx.material.findMany({
    where: { id: { in: [...materialIds] }, tenantId: scope.tenantId },
    select: { id: true, standardUnitCost: true },
  });
  const batches = await tx.inventoryBatch.findMany({
    where: { storeId: scope.storeId, materialId: { in: [...materialIds] } },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { materialId: true, unitCost: true },
  });
  const batchCost = new Map<string, number>();
  for (const batch of batches) {
    if (!batchCost.has(batch.materialId)) batchCost.set(batch.materialId, Number(batch.unitCost));
  }
  for (const material of materials) {
    const cost = batchCost.get(material.id)
      ?? (material.standardUnitCost === null ? 0 : Number(material.standardUnitCost));
    result.set(material.id, cost);
  }
  return result;
}

function buildPlanningSample(
  sample: {
    id: string;
    code: string;
    name: string;
    priority: number;
    materials: {
      materialId: string;
      quantity: Prisma.Decimal;
      material: {
        id: string;
        name: string;
        grade: string | null;
        baseUnit: string;
        quantityScale: number;
        standardUsableRate: Prisma.Decimal | null;
        optimisticUsableRate: Prisma.Decimal | null;
        flowerVariety: string | null;
        flowerProductName: string | null;
        color: string | null;
      };
    }[];
  },
  availability: Map<string, { availableQty: number; baseUnit: string; quantityScale: number }>,
  costs: Map<string, number>,
): SamplePlanningSample {
  const materials: SamplePlanningMaterial[] = sample.materials.map((line) => {
    const available = availability.get(line.materialId);
    return {
      materialId: line.materialId,
      name: line.material.name,
      grade: line.material.grade,
      baseUnit: line.material.baseUnit,
      quantityScale: line.material.quantityScale,
      quantity: Number(line.quantity),
      unitCost: costs.get(line.materialId) ?? 0,
      availableQty: available?.availableQty ?? 0,
      reusableRate: Number(line.material.standardUsableRate ?? line.material.optimisticUsableRate ?? 0),
      // Advisory recommendation signal only: it never changes quantity or cost.
      flowerVariety: line.material.flowerVariety,
      flowerProductName: line.material.flowerProductName,
      color: line.material.color,
    };
  });
  return {
    sampleId: sample.id,
    code: sample.code,
    name: sample.name,
    priority: sample.priority,
    materials,
  };
}

export async function saveSamplePlan(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  input: SaveSamplePlanInput,
): Promise<SaveSamplePlanResult> {
  assertScope(scope);
  const name = normalizedName(input.name);
  const items = normalizeItems(input.items ?? []);
  const sampleIds = items.map((item) => item.sampleId);
  const samples = await tx.sample.findMany({
    where: { id: { in: sampleIds }, tenantId: scope.tenantId },
    select: { id: true, code: true, name: true, state: true, _count: { select: { materials: true } } },
  });
  if (samples.length !== sampleIds.length) throw new Error("打样样品不存在或不属于当前租户");
  for (const sample of samples) {
    if (sample._count.materials === 0) throw new Error(`${sample.name} 还没有花材搭配`);
    if (sample.state === SampleState.ARCHIVED) throw new Error(`${sample.name} 已归档，不能加入打样计划`);
  }

  if (!input.id) {
    const created = await tx.samplePlan.create({
      data: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        name,
        state: SamplePlanState.DRAFT,
        items: {
          create: items.map((item) => ({
            sampleId: item.sampleId,
            quantity: item.quantity,
            mandatory: item.mandatory,
            candidateState: item.mandatory
              ? SamplePlanCandidateState.REQUIRED
              : SamplePlanCandidateState.OPTIONAL,
            sequenceNo: item.sequenceNo,
          })),
        },
      },
      select: { id: true, name: true, state: true },
    });
    await recordAudit(tx, scope, "SAMPLE_PLAN_CREATED", "SamplePlan", created.id, undefined, {
      name,
      items,
    });
    return created;
  }

  const planId = input.id.trim();
  if (!planId) throw new Error("打样计划标识不能为空");
  await lockPlan(tx, planId);
  const current = await loadPlan(tx, scope, planId);
  if (current.executions.length > 0 && current.executions.some((execution) => !execution.cancelledAt)) {
    throw new Error("打样计划已有执行记录，不能修改；请复制为新计划");
  }
  if (current.runs.length > 0) {
    throw new Error("打样计划已计算方案，不能修改样品；请复制为新计划后调整");
  }
  if (current.state === SamplePlanState.COMPLETED || current.state === SamplePlanState.IN_PROGRESS) {
    throw new Error("打样计划已开始，不能修改；请复制为新计划");
  }

  const updated = await tx.samplePlan.update({
    where: { id: planId },
    data: {
      name,
      state: SamplePlanState.DRAFT,
      selectedRunId: null,
      approvedAt: null,
      inventoryEvaluatedAt: null,
      estimatedPurchaseCost: null,
      estimatedSaving: null,
      items: {
        deleteMany: {},
        create: items.map((item) => ({
          sampleId: item.sampleId,
          quantity: item.quantity,
          mandatory: item.mandatory,
          candidateState: item.mandatory
            ? SamplePlanCandidateState.REQUIRED
            : SamplePlanCandidateState.OPTIONAL,
          sequenceNo: item.sequenceNo,
        })),
      },
      materials: { deleteMany: {} },
    },
    select: { id: true, name: true, state: true },
  });
  await recordAudit(
    tx,
    scope,
    "SAMPLE_PLAN_UPDATED",
    "SamplePlan",
    updated.id,
    {
      name: current.name,
      state: current.state,
      items: current.items.map((item) => ({
        sampleId: item.sampleId,
        quantity: item.quantity,
        mandatory: item.mandatory,
        sequenceNo: item.sequenceNo,
      })),
    },
    { name, items },
  );
  return updated;
}

export async function copySamplePlan(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
): Promise<SaveSamplePlanResult> {
  assertScope(scope);
  const current = await loadPlan(tx, scope, planId);
  if (current.items.length === 0) throw new Error("打样计划没有样品，不能复制");
  const created = await tx.samplePlan.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      name: `${current.name}（副本）`.slice(0, 100),
      state: SamplePlanState.DRAFT,
      items: {
        create: current.items.map((item) => ({
          sampleId: item.sampleId,
          quantity: item.quantity,
          mandatory: item.mandatory,
          candidateState: item.candidateState,
          sequenceNo: item.sequenceNo,
        })),
      },
    },
    select: { id: true, name: true, state: true },
  });
  await recordAudit(tx, scope, "SAMPLE_PLAN_COPIED", "SamplePlan", created.id, undefined, {
    sourcePlanId: current.id,
    sourceName: current.name,
    name: created.name,
  });
  return created;
}

function purchaseCostOfRun(
  result: { steps: { materials: { materialId?: string; purchaseQty: number; unitCost?: number }[] }[] },
  costs?: Map<string, number>,
): number {
  return roundMoney(result.steps.reduce(
    (sum, step) => sum + step.materials.reduce(
      (stepSum, material) => stepSum + material.purchaseQty
        * (material.unitCost ?? costs?.get(material.materialId ?? "") ?? 0),
      0,
    ),
    0,
  ));
}

async function persistPlanMaterialSummary(
  tx: Prisma.TransactionClient,
  planId: string,
  result: SamplePlanCalculationResult["runs"][number],
): Promise<void> {
  const byMaterial = new Map<string, {
    requiredQty: number;
    fromStockQty: number;
    reusedQty: number;
    purchaseQty: number;
    expectedLossQty: number;
  }>();
  for (const step of result.steps) {
    for (const material of step.materials) {
      const current = byMaterial.get(material.materialId) ?? {
        requiredQty: 0,
        fromStockQty: 0,
        reusedQty: 0,
        purchaseQty: 0,
        expectedLossQty: 0,
      };
      current.requiredQty = roundQty(current.requiredQty + material.requiredQty);
      current.fromStockQty = roundQty(current.fromStockQty + material.stockQty);
      current.reusedQty = roundQty(current.reusedQty + material.reusedQty);
      current.purchaseQty = roundQty(current.purchaseQty + material.purchaseQty);
      current.expectedLossQty = roundQty(current.expectedLossQty + material.lossQty);
      byMaterial.set(material.materialId, current);
    }
  }
  await tx.samplePlanMaterial.deleteMany({ where: { planId } });
  if (byMaterial.size === 0) return;
  await tx.samplePlanMaterial.createMany({
    data: [...byMaterial.entries()].map(([materialId, values]) => ({
      planId,
      materialId,
      ...values,
    })),
  });
}

export async function calculatePlan(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
): Promise<CalculateSamplePlanResult> {
  assertScope(scope);
  const id = typeof planId === "string" ? planId.trim() : "";
  if (!id) throw new Error("打样计划标识不能为空");
  await lockPlan(tx, id);
  const plan = await loadPlan(tx, scope, id);
  if (plan.executions.length > 0 && plan.executions.some((execution) => !execution.cancelledAt)) {
    throw new Error("打样计划已有执行记录，不能重新计算；请复制为新计划");
  }
  if (plan.state === SamplePlanState.COMPLETED || plan.state === SamplePlanState.IN_PROGRESS) {
    throw new Error("打样计划已开始，不能重新计算；请复制为新计划");
  }
  if (plan.items.length === 0) throw new Error("打样计划还没有样品");

  const selectedSamples = await tx.sample.findMany({
    where: { id: { in: plan.items.map((item) => item.sampleId) }, tenantId: scope.tenantId },
    include: {
      materials: {
        include: {
          material: {
            select: {
              id: true,
              name: true,
              grade: true,
              baseUnit: true,
              quantityScale: true,
              standardUsableRate: true,
              optimisticUsableRate: true,
              flowerVariety: true,
              flowerProductName: true,
              color: true,
            },
          },
        },
      },
    },
  });
  const candidateSamples = await tx.sample.findMany({
    where: {
      tenantId: scope.tenantId,
      state: SampleState.READY,
      id: { notIn: plan.items.map((item) => item.sampleId) },
    },
    include: {
      materials: {
        include: {
          material: {
            select: {
              id: true,
              name: true,
              grade: true,
              baseUnit: true,
              quantityScale: true,
              standardUsableRate: true,
              optimisticUsableRate: true,
              flowerVariety: true,
              flowerProductName: true,
              color: true,
            },
          },
        },
      },
    },
    orderBy: [{ priority: "desc" }, { code: "asc" }],
    take: 30,
  });

  const allSamples = [...selectedSamples, ...candidateSamples];
  const materialIds = [...new Set(allSamples.flatMap((sample) => sample.materials.map((line) => line.materialId)))];
  const availability = await getMaterialAvailableQuantities(tx, {
    tenantId: scope.tenantId,
    storeId: scope.storeId,
    materialIds,
  });
  const costs = await loadMaterialCosts(tx, scope, materialIds);
  const availabilityInput = new Map(
    [...availability.entries()].map(([materialId, value]) => [materialId, {
      availableQty: value.availableQty,
      baseUnit: value.baseUnit,
      quantityScale: value.quantityScale,
    }]),
  );

  const planningSamples = allSamples.map((sample) =>
    buildPlanningSample(sample, availabilityInput, costs)
  );
  const selections = plan.items.map((item) => ({
    sampleId: item.sampleId,
    quantity: item.quantity,
    mandatory: item.mandatory,
    sequenceNo: item.sequenceNo,
  }));
  const calculated = calculateSamplePlan({
    samples: planningSamples,
    selections,
    defaultReusableRate: 0,
  });

  const now = new Date();
  const calculationGroupId = crypto.randomUUID();
  const latest = await tx.samplePlanRun.findFirst({
    where: { planId: id },
    orderBy: { runNo: "desc" },
    select: { runNo: true },
  });
  let nextRunNo = (latest?.runNo ?? 0) + 1;
  const createdRuns: { id: string; rank: number }[] = [];

  for (const result of calculated.runs) {
    const run = await tx.samplePlanRun.create({
      data: {
        planId: id,
        runNo: nextRunNo,
        calculationGroupId,
        rank: result.rank,
        algorithmVersion: result.algorithmVersion,
        calculatedAt: now,
        requestedSampleCount: result.requestedSampleCount,
        lossPolicySnapshot: result.lossPolicySnapshot,
        candidateSnapshot: result.candidateSnapshot,
        inventoryBaselineAt: now,
        independentCost: result.independentCost,
        totalCost: result.totalCost,
        estimatedSaving: result.estimatedSaving,
        reuseRate: result.reuseRate,
        inventory: {
          create: result.inventory.map((snapshot) => ({
            materialId: snapshot.materialId,
            availableQty: snapshot.availableQty,
            unitCost: snapshot.unitCost,
            unitSnapshot: snapshot.unitSnapshot,
          })),
        },
        steps: {
          create: result.steps.map((step) => ({
            sequenceNo: step.sequenceNo,
            sampleId: step.sampleId,
            sampleNameSnapshot: step.sampleNameSnapshot,
            plannedQuantity: step.plannedQuantity,
            incrementalCost: step.incrementalCost,
            flows: {
              create: step.materials.map((material) => ({
                materialId: material.materialId,
                materialNameSnapshot: material.materialNameSnapshot,
                gradeSnapshot: material.gradeSnapshot,
                unitSnapshot: `${material.baseUnit} / 可用 ${material.availableQty} / 复用率 ${(material.reusableRate * 100).toFixed(0)}%`,
                requiredQty: material.requiredQty,
                stockQty: material.stockQty,
                reusedQty: material.reusedQty,
                purchaseQty: material.purchaseQty,
                reusableAfterDisassemblyQty: material.reusableAfterDisassemblyQty,
                lossQty: material.lossQty,
                poolRemainingQty: material.poolRemainingQty,
                incrementalCost: material.incrementalCost,
              })),
            },
          })),
        },
      },
      select: { id: true, rank: true },
    });
    createdRuns.push(run);
    nextRunNo += 1;
  }

  const topRun = createdRuns.find((run) => run.rank === 1) ?? createdRuns[0];
  if (!topRun) throw new Error("打样计划未能生成方案");
  const topResult = calculated.runs.find((run) => run.rank === 1) ?? calculated.runs[0]!;
  await persistPlanMaterialSummary(tx, id, topResult);
  await tx.samplePlan.update({
    where: { id },
    data: {
      state: SamplePlanState.PROPOSED,
      inventoryEvaluatedAt: now,
      estimatedPurchaseCost: purchaseCostOfRun(topResult),
      estimatedSaving: topResult.estimatedSaving,
      selectedRunId: topRun.id,
    },
  });
  await recordAudit(tx, scope, "SAMPLE_PLAN_CALCULATED", "SamplePlan", id, undefined, {
    calculationGroupId,
    runIds: createdRuns.map((run) => run.id),
    ranks: createdRuns.map((run) => run.rank),
    warnings: calculated.warnings,
    topRunId: topRun.id,
    totalCost: topResult.totalCost,
    estimatedSaving: topResult.estimatedSaving,
  });

  const runRows = await tx.samplePlanRun.findMany({
    where: { id: { in: createdRuns.map((run) => run.id) } },
    include: {
      steps: { include: { flows: true } },
    },
  });
  return {
    planId: id,
    calculationGroupId,
    warnings: calculated.warnings,
    runs: runRows.map((run) => ({
      id: run.id,
      rank: run.rank,
      requestedSampleCount: run.requestedSampleCount,
      independentCost: Number(run.independentCost),
      totalCost: Number(run.totalCost),
      estimatedSaving: Number(run.estimatedSaving),
      reuseRate: Number(run.reuseRate),
      stepCount: run.steps.length,
      purchaseQty: roundQty(run.steps.reduce(
        (sum, step) => sum + step.flows.reduce((stepSum, flow) => stepSum + Number(flow.purchaseQty), 0),
        0,
      )),
      createdAt: run.calculatedAt,
      selected: run.id === topRun.id,
    })),
  };
}

export async function selectPlanRun(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
  runId: string,
): Promise<{ planId: string; runId: string }> {
  assertScope(scope);
  const id = typeof planId === "string" ? planId.trim() : "";
  const selectedRunId = typeof runId === "string" ? runId.trim() : "";
  if (!id || !selectedRunId) throw new Error("打样计划或方案标识不能为空");
  await lockPlan(tx, id);
  const plan = await loadPlan(tx, scope, id);
  if (plan.executions.length > 0 && plan.executions.some((execution) => !execution.cancelledAt)) {
    throw new Error("打样计划已有执行记录，不能改选方案");
  }
  if (plan.state === SamplePlanState.APPROVED || plan.state === SamplePlanState.IN_PROGRESS ||
      plan.state === SamplePlanState.COMPLETED) {
    throw new Error("打样计划已批准，不能改选方案");
  }
  const run = await tx.samplePlanRun.findFirst({
    where: { id: selectedRunId, planId: id },
    include: {
      steps: { include: { flows: true } },
      inventory: { select: { materialId: true, unitCost: true } },
    },
  });
  if (!run) throw new Error("方案不存在或不属于当前打样计划");
  const costMap = new Map(run.inventory.map((row) => [row.materialId, Number(row.unitCost)]));
  await tx.samplePlan.update({
    where: { id },
    data: {
      selectedRunId: run.id,
      state: SamplePlanState.PROPOSED,
      estimatedPurchaseCost: purchaseCostOfRun({
        steps: run.steps.map((step) => ({
          materials: step.flows.map((flow) => ({
            materialId: flow.materialId,
            purchaseQty: Number(flow.purchaseQty),
          })),
        })),
      }, costMap),
    },
  });
  await recordAudit(tx, scope, "SAMPLE_PLAN_RUN_SELECTED", "SamplePlan", id, undefined, {
    runId: run.id,
    rank: run.rank,
  });
  return { planId: id, runId: run.id };
}

// ---------------------------------------------------------------------------
// Approval, issue and execution
// ---------------------------------------------------------------------------

type BatchAvailabilityRow = {
  batchId: string;
  materialId: string;
  onHand: number;
  frozen: number;
  orderReserved: number;
  sampleReserved: number;
  usableUntil: Date | null;
  receivedAt: Date;
};

async function loadCandidateBatches(
  tx: Prisma.TransactionClient,
  storeId: string,
  materialId: string,
  needBy: Date,
): Promise<BatchAvailabilityRow[]> {
  const candidates = await tx.inventoryBatch.findMany({
    where: {
      storeId,
      materialId,
      OR: [{ usableUntil: null }, { usableUntil: { gte: needBy } }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const candidate of candidates) {
    await lockBatchRow(tx, candidate.id);
    await lockBatchBalances(tx, candidate.id);
  }
  const ids = candidates.map((candidate) => candidate.id);
  if (ids.length === 0) return [];
  const batches = await tx.inventoryBatch.findMany({
    where: { id: { in: ids } },
    include: { balances: { include: { location: { select: { kind: true } } } } },
  });
  const orders = await tx.inventoryReservation.groupBy({
    by: ["batchId"],
    where: { batchId: { in: ids }, state: ReservationState.ACTIVE },
    _sum: { quantity: true },
  });
  const samples = await tx.sampleInventoryReservation.groupBy({
    by: ["batchId"],
    where: { batchId: { in: ids }, state: ReservationState.ACTIVE },
    _sum: { quantity: true },
  });
  const orderByBatch = new Map(orders.map((row) => [row.batchId, Number(row._sum.quantity ?? 0)]));
  const sampleByBatch = new Map(samples.map((row) => [row.batchId, Number(row._sum.quantity ?? 0)]));
  return batches.map((batch) => {
    const warehouse = batch.balances.filter((balance) => balance.location.kind === LocationKind.WAREHOUSE);
    return {
      batchId: batch.id,
      materialId: batch.materialId,
      onHand: warehouse.reduce((sum, balance) => sum + Number(balance.onHandQty), 0),
      frozen: warehouse.reduce((sum, balance) => sum + Number(balance.frozenQty), 0),
      orderReserved: orderByBatch.get(batch.id) ?? 0,
      sampleReserved: sampleByBatch.get(batch.id) ?? 0,
      usableUntil: batch.usableUntil,
      receivedAt: batch.receivedAt,
    };
  });
}

async function reserveStepMaterials(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  executionId: string,
  executionStepId: string,
  requirements: readonly { materialId: string; quantity: number; quantityScale: number; baseUnit: string }[],
): Promise<{ reservedQty: number; shortageQty: number; shortage: string[] }> {
  let reservedQty = 0;
  let shortageQty = 0;
  const shortage: string[] = [];
  const now = new Date();
  for (const requirement of requirements) {
    const quantity = roundQty(requirement.quantity);
    if (quantity <= EPSILON) continue;
    assertMaterialQuantity(quantity, requirement.quantityScale);
    const batches = await loadCandidateBatches(tx, scope.storeId, requirement.materialId, now);
    let remaining = quantity;
    const ordered = [...batches].sort((left, right) => {
      if (left.usableUntil && right.usableUntil) {
        const expiry = left.usableUntil.getTime() - right.usableUntil.getTime();
        if (expiry !== 0) return expiry;
      } else if (left.usableUntil) {
        return -1;
      } else if (right.usableUntil) {
        return 1;
      }
      return left.receivedAt.getTime() - right.receivedAt.getTime() ||
        left.batchId.localeCompare(right.batchId);
    });
    for (const batch of ordered) {
      if (remaining <= EPSILON) break;
      const available = Math.max(
        0,
        batch.onHand - batch.frozen - batch.orderReserved - batch.sampleReserved,
      );
      const take = roundQty(Math.min(available, remaining));
      if (take <= EPSILON) continue;
      await tx.sampleInventoryReservation.create({
        data: {
          executionId,
          executionStepId,
          batchId: batch.batchId,
          quantity: take,
          state: ReservationState.ACTIVE,
        },
      });
      reservedQty = roundQty(reservedQty + take);
      remaining = roundQty(remaining - take);
    }
    if (remaining > EPSILON) {
      shortageQty = roundQty(shortageQty + remaining);
      shortage.push(`${requirement.materialId} 缺 ${remaining}${requirement.baseUnit}`);
    }
  }
  return { reservedQty, shortageQty, shortage };
}

async function warehouseLocation(tx: Prisma.TransactionClient, storeId: string) {
  const location = await tx.inventoryLocation.findFirst({
    where: { storeId, kind: LocationKind.WAREHOUSE },
    orderBy: { code: "asc" },
  });
  if (!location) throw new Error("缺少仓库库位");
  return location;
}

async function productionLocation(tx: Prisma.TransactionClient, storeId: string) {
  const location = await tx.inventoryLocation.findFirst({
    where: { storeId, kind: LocationKind.PRODUCTION },
    orderBy: { code: "asc" },
  });
  if (!location) throw new Error("缺少制作区库位");
  return location;
}

async function debitBalances(
  tx: Prisma.TransactionClient,
  batchId: string,
  locationKind: LocationKind,
  quantity: number,
): Promise<{ locationId: string; quantity: number }[]> {
  if (quantity <= EPSILON) return [];
  const balances = await tx.batchBalance.findMany({
    where: { batchId, location: { kind: locationKind } },
    orderBy: { locationId: "asc" },
  });
  let remaining = quantity;
  const debits: { locationId: string; quantity: number }[] = [];
  for (const balance of balances) {
    if (remaining <= EPSILON) break;
    const take = roundQty(Math.min(Number(balance.onHandQty), remaining));
    if (take <= EPSILON) continue;
    await tx.batchBalance.update({
      where: { id: balance.id },
      data: { onHandQty: { decrement: take } },
    });
    debits.push({ locationId: balance.locationId, quantity: take });
    remaining = roundQty(remaining - take);
  }
  if (remaining > EPSILON) {
    throw new Error("仓库实存不足或批次位置不明，需人工处理");
  }
  return debits;
}

async function creditBalance(
  tx: Prisma.TransactionClient,
  batchId: string,
  locationId: string,
  quantity: number,
): Promise<void> {
  const existing = await tx.batchBalance.findFirst({
    where: { batchId, locationId },
    orderBy: { id: "asc" },
  });
  if (existing) {
    await tx.batchBalance.update({
      where: { id: existing.id },
      data: { onHandQty: { increment: quantity } },
    });
  } else {
    await tx.batchBalance.create({
      data: { batchId, locationId, onHandQty: quantity },
    });
  }
}

async function issueStepReservations(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  executionId: string,
  executionStepId: string,
): Promise<{ issuedQty: number; issuedByMaterial: Map<string, number> }> {
  const production = await productionLocation(tx, scope.storeId);
  const reservations = await tx.sampleInventoryReservation.findMany({
    where: { executionId, executionStepId, state: ReservationState.ACTIVE },
    include: { batch: { include: { material: true } } },
    orderBy: { id: "asc" },
  });
  const batchIds = [...new Set(reservations.map((row) => row.batchId))].sort();
  for (const batchId of batchIds) {
    await lockBatchRow(tx, batchId);
    await lockBatchBalances(tx, batchId);
  }
  let issuedQty = 0;
  const issuedByMaterial = new Map<string, number>();
  for (const reservation of reservations) {
    const quantity = Number(reservation.quantity);
    if (quantity <= EPSILON) continue;
    const debits = await debitBalances(tx, reservation.batchId, LocationKind.WAREHOUSE, quantity);
    for (const debit of debits) {
      await tx.inventoryTransaction.create({
        data: {
          batchId: reservation.batchId,
          kind: TransactionKind.TRANSFER,
          quantity: debit.quantity,
          fromLocationId: debit.locationId,
          toLocationId: production.id,
          referenceType: "SAMPLE_PLAN_EXECUTION",
          referenceId: executionId,
          idempotencyKey: `v2-sample-issue-${reservation.id}-${debit.locationId}`,
        },
      });
    }
    await creditBalance(tx, reservation.batchId, production.id, quantity);
    await tx.sampleInventoryReservation.update({
      where: { id: reservation.id },
      data: { state: ReservationState.ISSUED },
    });
    issuedQty = roundQty(issuedQty + quantity);
    issuedByMaterial.set(
      reservation.batch.materialId,
      roundQty((issuedByMaterial.get(reservation.batch.materialId) ?? 0) + quantity),
    );
  }
  return { issuedQty, issuedByMaterial };
}

export async function approvePlan(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
): Promise<ApproveSamplePlanResult> {
  assertScope(scope);
  const id = typeof planId === "string" ? planId.trim() : "";
  if (!id) throw new Error("打样计划标识不能为空");
  await lockPlan(tx, id);
  const plan = await loadPlan(tx, scope, id);
  if (plan.executions.length > 0 && plan.executions.some((execution) => !execution.cancelledAt)) {
    throw new Error("打样计划已有执行记录，不能重复批准");
  }
  if (plan.state !== SamplePlanState.PROPOSED && plan.state !== SamplePlanState.DRAFT) {
    throw new Error("只有草稿或已算方案的打样计划可以批准");
  }
  if (!plan.selectedRunId) throw new Error("请先计算并选择打样方案");
  const run = await tx.samplePlanRun.findFirst({
    where: { id: plan.selectedRunId, planId: id },
    include: {
      steps: { include: { flows: true }, orderBy: { sequenceNo: "asc" } },
      inventory: true,
    },
  });
  if (!run) throw new Error("所选打样方案不存在");
  const firstStep = run.steps[0];
  if (!firstStep) throw new Error("打样方案没有制作步骤");

  const now = new Date();
  const execution = await tx.samplePlanExecution.create({
    data: {
      planId: id,
      selectedRunId: run.id,
      approvedAt: now,
    },
    select: { id: true },
  });
  const executionSteps = await tx.samplePlanExecutionStep.createManyAndReturn({
    data: run.steps.map((step) => ({
      executionId: execution.id,
      plannedStepId: step.id,
    })),
    select: { id: true, plannedStepId: true },
  });
  const firstExecutionStep = executionSteps.find((step) => step.plannedStepId === firstStep.id);
  if (!firstExecutionStep) throw new Error("打样执行步骤创建失败");

  const flowScales = await materialScales(
    tx,
    scope.tenantId,
    firstStep.flows.map((flow) => flow.materialId),
  );
  const requirements = firstStep.flows
    .filter((flow) => Number(flow.requiredQty) - Number(flow.reusedQty) > EPSILON)
    .map((flow) => {
      const scale = flowScales.get(flow.materialId);
      return {
        materialId: flow.materialId,
        // Re-check current stock instead of trusting the calculation snapshot:
        // newly arrived stock can reduce the purchase requirement.
        quantity: roundQty(Number(flow.requiredQty) - Number(flow.reusedQty)),
        quantityScale: scale?.quantityScale ?? 0,
        baseUnit: scale?.baseUnit ?? "",
      };
    });
  const reserved = await reserveStepMaterials(
    tx, scope, execution.id, firstExecutionStep.id, requirements,
  );
  const costMap = new Map(run.inventory.map((row) => [row.materialId, Number(row.unitCost)]));
  await tx.samplePlan.update({
    where: { id },
    data: {
      state: SamplePlanState.APPROVED,
      approvedAt: now,
      inventoryEvaluatedAt: now,
      selectedRunId: run.id,
      estimatedPurchaseCost: purchaseCostOfRun({
        steps: run.steps.map((step) => ({
          materials: step.flows.map((flow) => ({
            materialId: flow.materialId,
            purchaseQty: Number(flow.purchaseQty),
          })),
        })),
      }, costMap),
      estimatedSaving: Number(run.estimatedSaving),
    },
  });
  await recordAudit(tx, scope, "SAMPLE_PLAN_APPROVED", "SamplePlan", id, undefined, {
    executionId: execution.id,
    runId: run.id,
    reservedQty: reserved.reservedQty,
    shortageQty: reserved.shortageQty,
    shortage: reserved.shortage,
  });
  return {
    executionId: execution.id,
    reservedQty: reserved.reservedQty,
    shortageQty: reserved.shortageQty,
  };
}

async function loadExecution(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
) {
  const execution = await tx.samplePlanExecution.findFirst({
    where: { planId, cancelledAt: null, plan: { tenantId: scope.tenantId, storeId: scope.storeId } },
    orderBy: { approvedAt: "desc" },
    include: {
      plan: { include: { items: true } },
      selectedRun: {
        include: {
          steps: {
            include: { flows: true, sample: { select: { id: true, code: true, name: true } } },
            orderBy: { sequenceNo: "asc" },
          },
        },
      },
      steps: {
        include: {
          plannedStep: { include: { flows: true, sample: true } },
          reservations: { include: { batch: { include: { material: true } } } },
          disassembledMaterials: true,
        },
        orderBy: { plannedStep: { sequenceNo: "asc" } },
      },
    },
  });
  if (!execution) throw new Error("打样计划还没有执行记录，请先批准");
  return execution;
}

type StartFirstStepResult = {
  executionId: string;
  firstStepId: string;
  issuedQty: number;
};

/**
 * Shared by the explicit "start" action and by direct step completion.
 * It re-checks the first-step reservation, moves stock to the production area
 * and marks the execution as started in the caller's transaction.
 */
async function startFirstStep(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
  execution: Awaited<ReturnType<typeof loadExecution>>,
): Promise<StartFirstStepResult> {
  const firstStep = execution.steps[0];
  if (!firstStep) throw new Error("打样执行没有步骤");
  const issuedReservations = firstStep.reservations.filter((row) => row.state === ReservationState.ACTIVE);
  const plannedReserved = firstStep.plannedStep.flows.reduce(
    (sum, flow) => sum + Number(flow.requiredQty),
    0,
  );
  const actualReserved = issuedReservations.reduce((sum, row) => sum + Number(row.quantity), 0);
  if (actualReserved + EPSILON < plannedReserved) {
    throw new Error(
      `首次制作缺料：计划需要 ${plannedReserved}，当前只预留 ${actualReserved}，请补购或重新计算方案`,
    );
  }
  const issued = await issueStepReservations(tx, scope, execution.id, firstStep.id);
  const now = new Date();
  await tx.samplePlanExecutionStep.update({
    where: { id: firstStep.id },
    data: { startedAt: now },
  });
  await tx.samplePlanExecution.update({
    where: { id: execution.id },
    data: { startedAt: now },
  });
  await tx.samplePlan.update({
    where: { id: planId },
    data: { state: SamplePlanState.IN_PROGRESS },
  });
  await recordAudit(tx, scope, "SAMPLE_PLAN_STARTED", "SamplePlan", planId, undefined, {
    executionId: execution.id,
    firstStepId: firstStep.id,
    issuedQty: issued.issuedQty,
  });
  return { executionId: execution.id, firstStepId: firstStep.id, issuedQty: issued.issuedQty };
}

export async function startPlan(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
): Promise<{ executionId: string; issuedQty: number }> {
  assertScope(scope);
  const id = typeof planId === "string" ? planId.trim() : "";
  if (!id) throw new Error("打样计划标识不能为空");
  await lockPlan(tx, id);
  await lockStoreRow(tx, scope.storeId);
  const execution = await loadExecution(tx, scope, id);
  if (execution.startedAt) throw new Error("打样计划已经开始，不能重复开始");
  if (execution.plan.state !== SamplePlanState.APPROVED) {
    throw new Error("只有已批准的打样计划可以开始");
  }
  const started = await startFirstStep(tx, scope, id, execution);
  return { executionId: started.executionId, issuedQty: started.issuedQty };
}

function snapshotReusedByMaterial(value: Prisma.JsonValue | null): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = (value as Record<string, unknown>).reusedByMaterial;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [materialId, quantity] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0) {
      result[materialId] = quantity;
    }
  }
  return result;
}

async function poolByMaterial(
  tx: Prisma.TransactionClient,
  executionId: string,
): Promise<Map<string, number>> {
  const steps = await tx.samplePlanExecutionStep.findMany({
    where: { executionId },
    include: { disassembledMaterials: true },
  });
  const pool = new Map<string, number>();
  for (const step of steps) {
    for (const material of step.disassembledMaterials) {
      pool.set(
        material.materialId,
        roundQty((pool.get(material.materialId) ?? 0) + Number(material.usableQty)),
      );
    }
  }
  for (const step of steps) {
    const reused = snapshotReusedByMaterial(step.actualReusableSnapshot);
    for (const [materialId, quantity] of Object.entries(reused)) {
      pool.set(materialId, roundQty(Math.max(0, (pool.get(materialId) ?? 0) - quantity)));
    }
  }
  return pool;
}

async function startPendingStep(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
  execution: Awaited<ReturnType<typeof loadExecution>>,
): Promise<{ stepId: string; issuedQty: number; reusedQty: number }> {
  const pending = execution.steps.find((step) => !step.completedAt);
  if (!pending) throw new Error("没有待执行的打样步骤");
  if (pending.startedAt) throw new Error("当前步骤已经开始，请先完成本步");
  const sequenceNo = pending.plannedStep.sequenceNo;
  const previous = execution.steps.find((step) => step.plannedStep.sequenceNo === sequenceNo - 1);
  if (previous && !previous.completedAt) throw new Error("上一步尚未完成");

  const pool = await poolByMaterial(tx, execution.id);
  const reusedByMaterial: Record<string, number> = {};
  let reusedQty = 0;
  const flowMaterialIds = pending.plannedStep.flows.map((flow) => flow.materialId);
  const scales = await materialScales(tx, scope.tenantId, flowMaterialIds);
  const requirements: { materialId: string; quantity: number; quantityScale: number; baseUnit: string }[] = [];
  for (const flow of pending.plannedStep.flows) {
    const required = Number(flow.requiredQty);
    if (required <= EPSILON) continue;
    const availablePool = pool.get(flow.materialId) ?? 0;
    const reused = roundQty(Math.min(availablePool, required));
    if (reused > EPSILON) {
      reusedByMaterial[flow.materialId] = reused;
      reusedQty = roundQty(reusedQty + reused);
    }
    const remaining = roundQty(required - reused);
    if (remaining > EPSILON) {
      const scale = scales.get(flow.materialId);
      requirements.push({
        materialId: flow.materialId,
        quantity: remaining,
        quantityScale: scale?.quantityScale ?? 0,
        baseUnit: scale?.baseUnit ?? "",
      });
    }
  }
  const reserved = await reserveStepMaterials(
    tx, scope, execution.id, pending.id, requirements,
  );
  if (reserved.shortageQty > EPSILON) {
    throw new Error(
      `实际拆解后余下步骤缺料 ${reserved.shortageQty}，请补购、调整顺序或缩减计划（${reserved.shortage.join("；")}）`,
    );
  }
  const issued = await issueStepReservations(tx, scope, execution.id, pending.id);
  const now = new Date();
  await tx.samplePlanExecutionStep.update({
    where: { id: pending.id },
    data: {
      startedAt: now,
      reusedQty,
      actualReusableSnapshot: {
        reusedByMaterial,
        plannedRequiredByMaterial: Object.fromEntries(
          pending.plannedStep.flows.map((flow) => [flow.materialId, Number(flow.requiredQty)]),
        ),
      },
    },
  });
  await recordAudit(tx, scope, "SAMPLE_PLAN_STEP_STARTED", "SamplePlan", planId, undefined, {
    executionId: execution.id,
    stepId: pending.id,
    sequenceNo,
    reusedQty,
    issuedQty: issued.issuedQty,
  });
  return { stepId: pending.id, issuedQty: issued.issuedQty, reusedQty };
}

export async function startNextStep(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
): Promise<{ stepId: string; issuedQty: number; reusedQty: number }> {
  assertScope(scope);
  const id = typeof planId === "string" ? planId.trim() : "";
  if (!id) throw new Error("打样计划标识不能为空");
  await lockPlan(tx, id);
  await lockStoreRow(tx, scope.storeId);
  const execution = await loadExecution(tx, scope, id);
  if (!execution.startedAt) throw new Error("打样计划尚未开始");
  if (execution.plan.state !== SamplePlanState.IN_PROGRESS) {
    throw new Error("打样计划当前不在执行中");
  }
  return startPendingStep(tx, scope, id, execution);
}

/**
 * Completing a step directly is allowed by WMS-BR-SMP-005. When no step has
 * been started yet, the same transaction performs the first-step reservation
 * check and issue transfer; later steps get the same actual-reuse calculation
 * and issue transfer as the explicit "start next step" action.
 */
async function ensureCurrentStepStarted(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
  execution: Awaited<ReturnType<typeof loadExecution>>,
): Promise<{ stepId: string; autoStarted: boolean; issuedQty: number; reusedQty: number }> {
  const started = execution.steps.find((step) => step.startedAt && !step.completedAt);
  if (started) {
    return {
      stepId: started.id,
      autoStarted: false,
      issuedQty: 0,
      reusedQty: Number(started.reusedQty),
    };
  }
  if (!execution.startedAt) {
    if (execution.plan.state !== SamplePlanState.APPROVED) {
      throw new Error("打样计划尚未批准，不能直接完成");
    }
    const result = await startFirstStep(tx, scope, planId, execution);
    return {
      stepId: result.firstStepId,
      autoStarted: true,
      issuedQty: result.issuedQty,
      reusedQty: 0,
    };
  }
  if (execution.plan.state !== SamplePlanState.IN_PROGRESS) {
    throw new Error("打样计划当前不在执行中");
  }
  const result = await startPendingStep(tx, scope, planId, execution);
  return {
    stepId: result.stepId,
    autoStarted: true,
    issuedQty: result.issuedQty,
    reusedQty: result.reusedQty,
  };
}

type OutstandingProductionRow = {
  batchId: string;
  materialId: string;
  quantity: number;
};

/**
 * Material that is still physically attributable to an execution in the
 * production area: issued reservations minus normal production consumption.
 * Pause/cancel returns and losses are not subtracted here because they also
 * reduce the issued reservation quantities, so each fact is counted once.
 */
async function outstandingProductionByBatch(
  tx: Prisma.TransactionClient,
  executionId: string,
): Promise<Map<string, OutstandingProductionRow>> {
  const outstanding = new Map<string, OutstandingProductionRow>();
  const issuedRows = await tx.sampleInventoryReservation.findMany({
    where: {
      executionId,
      state: { in: [ReservationState.ISSUED, ReservationState.CONSUMED] },
    },
    select: {
      batchId: true,
      quantity: true,
      batch: { select: { materialId: true } },
    },
    orderBy: { id: "asc" },
  });
  for (const row of issuedRows) {
    const current = outstanding.get(row.batchId) ?? {
      batchId: row.batchId,
      materialId: row.batch.materialId,
      quantity: 0,
    };
    current.quantity = roundQty(current.quantity + Number(row.quantity));
    outstanding.set(row.batchId, current);
  }
  const consumedRows = await tx.inventoryTransaction.groupBy({
    by: ["batchId"],
    where: {
      referenceType: "SAMPLE_PLAN_EXECUTION",
      referenceId: executionId,
      kind: TransactionKind.CONSUME,
    },
    _sum: { quantity: true },
  });
  for (const row of consumedRows) {
    const current = outstanding.get(row.batchId);
    if (!current) continue;
    current.quantity = roundQty(Math.max(0, current.quantity - Number(row._sum.quantity ?? 0)));
  }
  for (const [batchId, row] of outstanding) {
    if (row.quantity <= EPSILON) outstanding.delete(batchId);
  }
  return outstanding;
}

type ProductionDispositionOptions = {
  referenceType: string;
  lossNote: string;
  eventKey: string;
  reduceReservations: boolean;
  adjustDisassemblyPool: boolean;
};

type ProductionDispositionResult = {
  returnedQty: number;
  keptQty: number;
  lostQty: number;
  resolutions: {
    batchId: string;
    materialId: string;
    returnQty: number;
    keepQty: number;
    lossQty: number;
    reverified: boolean;
    usableUntil: string | null;
  }[];
};

/**
 * Reduces the issued reservation quantities that back the material being
 * returned or written off. The aggregate issued quantity then matches what is
 * still physically attached to the execution, so a later pause/cancel does not
 * ask the employee to dispose of the same stock twice. The current execution
 * step is reduced first; leftover reusable material from completed steps is
 * reduced afterwards.
 */
async function reduceReservationsForDisposal(
  tx: Prisma.TransactionClient,
  executionId: string,
  batchId: string,
  quantity: number,
): Promise<number> {
  if (quantity <= EPSILON) return 0;
  const rows = await tx.sampleInventoryReservation.findMany({
    where: {
      executionId,
      batchId,
      state: { in: [ReservationState.ISSUED, ReservationState.CONSUMED] },
    },
    orderBy: { id: "asc" },
  });
  rows.sort((left, right) => {
    const rank = (state: ReservationState) => state === ReservationState.ISSUED ? 0 : 1;
    return rank(left.state) - rank(right.state) || left.id.localeCompare(right.id);
  });
  let remaining = quantity;
  let consumedReduced = 0;
  for (const row of rows) {
    if (remaining <= EPSILON) break;
    const current = Number(row.quantity);
    const take = roundQty(Math.min(current, remaining));
    if (take <= EPSILON) continue;
    const next = roundQty(current - take);
    await tx.sampleInventoryReservation.update({
      where: { id: row.id },
      data: {
        quantity: next,
        state: next <= EPSILON ? ReservationState.RELEASED : row.state,
      },
    });
    if (row.state === ReservationState.CONSUMED) {
      consumedReduced = roundQty(consumedReduced + take);
    }
    remaining = roundQty(remaining - take);
  }
  return consumedReduced;
}

/**
 * Returning or writing off leftover reusable material must also remove it from
 * the reuse pool used by the next sample step. Without this adjustment the next
 * step would plan to reuse material that is no longer in the production area.
 */
async function reduceDisassemblyPool(
  tx: Prisma.TransactionClient,
  executionId: string,
  materialId: string,
  quantity: number,
): Promise<void> {
  if (quantity <= EPSILON) return;
  const steps = await tx.samplePlanExecutionStep.findMany({
    where: { executionId },
    select: { actualReusableSnapshot: true },
  });
  let reusedQty = 0;
  for (const step of steps) {
    reusedQty = roundQty(reusedQty + (snapshotReusedByMaterial(step.actualReusableSnapshot)[materialId] ?? 0));
  }
  const rows = await tx.sampleDisassemblyMaterial.findMany({
    where: { executionStep: { executionId }, materialId },
    orderBy: [{ checkedAt: "asc" }, { id: "asc" }],
  });
  const totalUsable = roundQty(rows.reduce((sum, row) => sum + Number(row.usableQty), 0));
  const available = roundQty(Math.max(0, totalUsable - reusedQty));
  let remaining = roundQty(Math.min(quantity, available));
  for (const row of rows) {
    if (remaining <= EPSILON) break;
    const current = Number(row.usableQty);
    const take = roundQty(Math.min(current, remaining));
    if (take <= EPSILON) continue;
    await tx.sampleDisassemblyMaterial.update({
      where: { id: row.id },
      data: { usableQty: roundQty(current - take) },
    });
    remaining = roundQty(remaining - take);
  }
}

/**
 * Applies the employee's explicit production-area decision (return, keep or
 * write off) for every outstanding batch. WMS-BR-SMP-007 requires an explicit
 * decision instead of assuming material is still usable.
 */
async function resolveProductionDisposition(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  executionId: string,
  outstanding: Map<string, OutstandingProductionRow>,
  resolutions: readonly SamplePlanMaterialResolutionInput[] | undefined,
  options: ProductionDispositionOptions,
): Promise<ProductionDispositionResult> {
  const resolutionByBatch = new Map<string, SamplePlanMaterialResolutionInput>();
  for (const resolution of resolutions ?? []) {
    const batchId = typeof resolution?.batchId === "string" ? resolution.batchId.trim() : "";
    if (!batchId) throw new Error("处置批次不能为空");
    if (resolutionByBatch.has(batchId)) throw new Error(`批次 ${batchId} 的处置重复`);
    if (!outstanding.has(batchId)) {
      throw new Error(`批次 ${batchId} 不在当前制作区待处置范围内`);
    }
    resolutionByBatch.set(batchId, resolution);
  }
  for (const row of outstanding.values()) {
    if (!resolutionByBatch.has(row.batchId)) {
      throw new Error(`批次 ${row.batchId} 还有 ${row.quantity} 未处理，请确认回库、留用或报损数量`);
    }
  }

  type Validated = {
    row: OutstandingProductionRow;
    returnQty: number;
    keepQty: number;
    lossQty: number;
    reverified: boolean;
    usableUntil: Date | null;
  };
  const validated: Validated[] = [];
  for (const row of outstanding.values()) {
    const resolution = resolutionByBatch.get(row.batchId)!;
    const returnQty = decimal(resolution.returnQty ?? 0, "回库数量");
    const keepQty = decimal(resolution.keepQty ?? 0, "留用数量");
    const lossQty = decimal(resolution.lossQty ?? 0, "报损数量");
    if (Math.abs(returnQty + keepQty + lossQty - row.quantity) > EPSILON) {
      throw new Error(
        `批次 ${row.batchId} 的回库、留用与报损数量必须等于未处理数量 ${row.quantity}`,
      );
    }
    const usableUntil = resolution.usableUntil ? new Date(resolution.usableUntil) : null;
    if (usableUntil && Number.isNaN(usableUntil.getTime())) {
      throw new Error("回库最晚可用时间无效");
    }
    if (returnQty > EPSILON) {
      if (!resolution.reverified) throw new Error("回库前必须重新验收等级和最晚可用时间");
      if (usableUntil && usableUntil.getTime() < Date.now()) {
        throw new Error("回库花材的最晚可用时间不能早于当前时间");
      }
    }
    validated.push({
      row,
      returnQty,
      keepQty,
      lossQty,
      reverified: Boolean(resolution.reverified),
      usableUntil,
    });
  }

  const needsWarehouse = validated.some((row) => row.returnQty > EPSILON);
  const needsProduction = validated.some((row) => row.returnQty > EPSILON || row.lossQty > EPSILON);
  const production = needsProduction ? await productionLocation(tx, scope.storeId) : null;
  const warehouse = needsWarehouse ? await warehouseLocation(tx, scope.storeId) : null;

  let returnedQty = 0;
  let keptQty = 0;
  let lostQty = 0;
  const auditRows: ProductionDispositionResult["resolutions"] = [];
  for (const entry of validated) {
    const { row, returnQty, keepQty, lossQty } = entry;
    if (returnQty > EPSILON) {
      await lockBatchRow(tx, row.batchId);
      await lockBatchBalances(tx, row.batchId);
      const debits = await debitBalances(tx, row.batchId, LocationKind.PRODUCTION, returnQty);
      for (const debit of debits) {
        await creditBalance(tx, row.batchId, warehouse!.id, debit.quantity);
        await tx.inventoryTransaction.create({
          data: {
            batchId: row.batchId,
            kind: TransactionKind.TRANSFER,
            quantity: debit.quantity,
            fromLocationId: debit.locationId,
            toLocationId: warehouse!.id,
            referenceType: options.referenceType,
            referenceId: executionId,
            idempotencyKey: `v2-sample-${options.eventKey}-return-${executionId}-${row.batchId}-${debit.locationId}`,
          },
        });
      }
      if (entry.usableUntil) {
        const batch = await tx.inventoryBatch.findUnique({
          where: { id: row.batchId },
          select: { usableUntil: true },
        });
        if (batch && (!batch.usableUntil || entry.usableUntil < batch.usableUntil)) {
          await tx.inventoryBatch.update({
            where: { id: row.batchId },
            data: { usableUntil: entry.usableUntil },
          });
        }
      }
      returnedQty = roundQty(returnedQty + returnQty);
    }
    if (lossQty > EPSILON) {
      await lockBatchRow(tx, row.batchId);
      await lockBatchBalances(tx, row.batchId);
      await debitBalances(tx, row.batchId, LocationKind.PRODUCTION, lossQty);
      await tx.inventoryTransaction.create({
        data: {
          batchId: row.batchId,
          kind: TransactionKind.CONSUME,
          quantity: lossQty,
          fromLocationId: production!.id,
          referenceType: options.referenceType,
          referenceId: executionId,
          idempotencyKey: `v2-sample-${options.eventKey}-loss-${executionId}-${row.batchId}`,
        },
      });
      await tx.lossRecord.create({
        data: {
          storeId: scope.storeId,
          batchId: row.batchId,
          materialId: row.materialId,
          reason: LossReason.OTHER,
          quantity: lossQty,
          note: options.lossNote,
          submittedById: scope.actorStaffId,
        },
      });
      lostQty = roundQty(lostQty + lossQty);
    }
    if (options.reduceReservations && returnQty + lossQty > EPSILON) {
      const consumedReduced = await reduceReservationsForDisposal(
        tx,
        executionId,
        row.batchId,
        roundQty(returnQty + lossQty),
      );
      if (options.adjustDisassemblyPool && consumedReduced > EPSILON) {
        await reduceDisassemblyPool(tx, executionId, row.materialId, consumedReduced);
      }
    }
    keptQty = roundQty(keptQty + keepQty);
    auditRows.push({
      batchId: row.batchId,
      materialId: row.materialId,
      returnQty,
      keepQty,
      lossQty,
      reverified: entry.reverified,
      usableUntil: entry.usableUntil?.toISOString() ?? null,
    });
  }
  return { returnedQty, keptQty, lostQty, resolutions: auditRows };
}

async function topUpStartedStep(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  execution: Awaited<ReturnType<typeof loadExecution>>,
): Promise<{ reissuedQty: number; shortageQty: number; shortage: string[] }> {
  const step = execution.steps.find((row) => row.startedAt && !row.completedAt);
  if (!step) return { reissuedQty: 0, shortageQty: 0, shortage: [] };
  const issuedByMaterial = new Map<string, number>();
  for (const reservation of step.reservations) {
    if (reservation.state !== ReservationState.ISSUED) continue;
    const materialId = reservation.batch.materialId;
    issuedByMaterial.set(
      materialId,
      roundQty((issuedByMaterial.get(materialId) ?? 0) + Number(reservation.quantity)),
    );
  }
  const reusedByMaterial = snapshotReusedByMaterial(step.actualReusableSnapshot);
  const scales = await materialScales(
    tx,
    scope.tenantId,
    step.plannedStep.flows.map((flow) => flow.materialId),
  );
  const requirements = step.plannedStep.flows
    .filter((flow) => Number(flow.requiredQty) > EPSILON)
    .map((flow) => {
      const scale = scales.get(flow.materialId);
      return {
        materialId: flow.materialId,
        quantity: roundQty(
          Math.max(
            0,
            Number(flow.requiredQty)
              - (reusedByMaterial[flow.materialId] ?? 0)
              - (issuedByMaterial.get(flow.materialId) ?? 0),
          ),
        ),
        quantityScale: scale?.quantityScale ?? 0,
        baseUnit: scale?.baseUnit ?? "",
      };
    })
    .filter((requirement) => requirement.quantity > EPSILON);
  if (requirements.length === 0) {
    return { reissuedQty: 0, shortageQty: 0, shortage: [] };
  }
  const reserved = await reserveStepMaterials(tx, scope, execution.id, step.id, requirements);
  if (reserved.shortageQty > EPSILON) {
    return { reissuedQty: 0, shortageQty: reserved.shortageQty, shortage: reserved.shortage };
  }
  const issued = await issueStepReservations(tx, scope, execution.id, step.id);
  return { reissuedQty: issued.issuedQty, shortageQty: 0, shortage: [] };
}

export type PauseSamplePlanResult = {
  planId: string;
  releasedReservations: number;
  releasedQty: number;
  issuedKeptQty: number;
  returnedQty: number;
  keptQty: number;
  lostQty: number;
  wasStarted: boolean;
};

/**
 * WMS-BR-SMP-007: pausing releases only reservations that were not issued yet.
 * Material already transferred to the production area needs an explicit
 * employee decision: return it to the warehouse, keep it in production for a
 * later resume, or write it off. The system records the decision and never
 * assumes the material is still usable.
 */
export async function pausePlan(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
  input: PauseSamplePlanInput = {},
): Promise<PauseSamplePlanResult> {
  assertScope(scope);
  const id = typeof planId === "string" ? planId.trim() : "";
  if (!id) throw new Error("打样计划标识不能为空");
  await lockPlan(tx, id);
  await lockStoreRow(tx, scope.storeId);
  const plan = await loadPlan(tx, scope, id);
  if (plan.state !== SamplePlanState.APPROVED && plan.state !== SamplePlanState.IN_PROGRESS) {
    throw new Error("只有已批准或制作中的打样计划可以暂停");
  }
  const execution = plan.executions.find((row) => !row.cancelledAt);
  if (!execution) throw new Error("打样计划还没有执行记录，不能暂停");
  const activeReservations = await tx.sampleInventoryReservation.findMany({
    where: { executionId: execution.id, state: ReservationState.ACTIVE },
    select: { quantity: true },
  });
  const releasedQty = roundQty(activeReservations.reduce(
    (sum, row) => sum + Number(row.quantity),
    0,
  ));
  const released = await tx.sampleInventoryReservation.updateMany({
    where: { executionId: execution.id, state: ReservationState.ACTIVE },
    data: { state: ReservationState.RELEASED },
  });
  const outstanding = await outstandingProductionByBatch(tx, execution.id);
  const disposition = await resolveProductionDisposition(
    tx,
    scope,
    execution.id,
    outstanding,
    input.resolutions,
    {
      referenceType: "SAMPLE_PLAN_PAUSE",
      lossNote: "打样暂停处置",
      eventKey: `pause-${randomUUID()}`,
      reduceReservations: true,
      adjustDisassemblyPool: true,
    },
  );
  await tx.samplePlan.update({
    where: { id },
    data: { state: SamplePlanState.PAUSED },
  });
  await recordAudit(tx, scope, "SAMPLE_PLAN_PAUSED", "SamplePlan", id, undefined, {
    executionId: execution.id,
    wasStarted: Boolean(execution.startedAt),
    releasedReservations: released.count,
    releasedQty,
    issuedKeptQty: disposition.keptQty,
    returnedQty: disposition.returnedQty,
    keptQty: disposition.keptQty,
    lostQty: disposition.lostQty,
    resolutions: disposition.resolutions,
  });
  return {
    planId: id,
    releasedReservations: released.count,
    releasedQty,
    issuedKeptQty: disposition.keptQty,
    returnedQty: disposition.returnedQty,
    keptQty: disposition.keptQty,
    lostQty: disposition.lostQty,
    wasStarted: Boolean(execution.startedAt),
  };
}

export type ResumeSamplePlanResult = {
  planId: string;
  state: SamplePlanState;
  reservedQty: number;
  shortageQty: number;
};

/**
 * Resuming a plan that never started re-checks current stock and re-creates the
 * first-step reservations released by pause. A plan paused while making samples
 * re-issues any current-step material that was returned or written off during
 * the pause, then returns to IN_PROGRESS. Kept material stays in the production
 * area and is not reserved twice.
 */
export async function resumePlan(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
): Promise<ResumeSamplePlanResult> {
  assertScope(scope);
  const id = typeof planId === "string" ? planId.trim() : "";
  if (!id) throw new Error("打样计划标识不能为空");
  await lockPlan(tx, id);
  await lockStoreRow(tx, scope.storeId);
  const plan = await loadPlan(tx, scope, id);
  if (plan.state !== SamplePlanState.PAUSED) {
    throw new Error("只有已暂停的打样计划可以恢复");
  }
  const execution = await loadExecution(tx, scope, id);
  if (execution.startedAt) {
    const topUp = await topUpStartedStep(tx, scope, execution);
    if (topUp.shortageQty > EPSILON) {
      throw new Error(
        `恢复打样缺料 ${topUp.shortageQty}，请补购或取消后重算（${topUp.shortage.join("；")}）`,
      );
    }
    await tx.samplePlan.update({
      where: { id },
      data: { state: SamplePlanState.IN_PROGRESS },
    });
    await recordAudit(tx, scope, "SAMPLE_PLAN_RESUMED", "SamplePlan", id, undefined, {
      executionId: execution.id,
      resumedState: SamplePlanState.IN_PROGRESS,
      reservedQty: topUp.reissuedQty,
      reissuedQty: topUp.reissuedQty,
      shortageQty: 0,
    });
    return {
      planId: id,
      state: SamplePlanState.IN_PROGRESS,
      reservedQty: topUp.reissuedQty,
      shortageQty: 0,
    };
  }

  const firstStep = execution.steps[0];
  if (!firstStep) throw new Error("打样执行没有步骤");
  const activeByMaterial = new Map<string, number>();
  for (const reservation of firstStep.reservations) {
    if (reservation.state !== ReservationState.ACTIVE) continue;
    const materialId = reservation.batch.materialId;
    activeByMaterial.set(
      materialId,
      roundQty((activeByMaterial.get(materialId) ?? 0) + Number(reservation.quantity)),
    );
  }
  const scales = await materialScales(
    tx,
    scope.tenantId,
    firstStep.plannedStep.flows.map((flow) => flow.materialId),
  );
  const requirements = firstStep.plannedStep.flows
    .filter((flow) => Number(flow.requiredQty) - Number(flow.reusedQty) > EPSILON)
    .map((flow) => {
      const scale = scales.get(flow.materialId);
      const alreadyActive = activeByMaterial.get(flow.materialId) ?? 0;
      return {
        materialId: flow.materialId,
        quantity: roundQty(
          Math.max(
            0,
            Number(flow.requiredQty) - Number(flow.reusedQty) - alreadyActive,
          ),
        ),
        quantityScale: scale?.quantityScale ?? 0,
        baseUnit: scale?.baseUnit ?? "",
      };
    })
    .filter((requirement) => requirement.quantity > EPSILON);
  const reserved = await reserveStepMaterials(
    tx, scope, execution.id, firstStep.id, requirements,
  );
  const existingActiveQty = [...activeByMaterial.values()].reduce(
    (sum, quantity) => roundQty(sum + quantity),
    0,
  );
  await tx.samplePlan.update({
    where: { id },
    data: { state: SamplePlanState.APPROVED },
  });
  await recordAudit(tx, scope, "SAMPLE_PLAN_RESUMED", "SamplePlan", id, undefined, {
    executionId: execution.id,
    resumedState: SamplePlanState.APPROVED,
    reservedQty: reserved.reservedQty,
    existingActiveQty,
    shortageQty: reserved.shortageQty,
    shortage: reserved.shortage,
  });
  return {
    planId: id,
    state: SamplePlanState.APPROVED,
    reservedQty: roundQty(existingActiveQty + reserved.reservedQty),
    shortageQty: reserved.shortageQty,
  };
}

export type RecalculateSamplePlanResult = CalculateSamplePlanResult & {
  releasedReservations: number;
  cancelledExecutionId: string | null;
};

/**
 * WMS-BR-SMP-004 / WMS-BR-SMP-009: after a customer order takes stock from an
 * approved but not started plan, the plan can be re-planned in place instead of
 * being cancelled and copied. The old execution is closed, its outstanding
 * reservations are released, and a fresh run is calculated against current
 * stock. The plan returns to PROPOSED so the employee can approve it again.
 */
export async function recalculatePlan(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
): Promise<RecalculateSamplePlanResult> {
  assertScope(scope);
  const id = typeof planId === "string" ? planId.trim() : "";
  if (!id) throw new Error("打样计划标识不能为空");
  await lockPlan(tx, id);
  const plan = await loadPlan(tx, scope, id);
  if (plan.state === SamplePlanState.COMPLETED) {
    throw new Error("已完成的打样计划不能重新计算");
  }
  if (plan.state === SamplePlanState.CANCELLED) {
    throw new Error("已取消的打样计划不能重新计算");
  }
  if (plan.state === SamplePlanState.IN_PROGRESS) {
    throw new Error("打样计划已开始制作，不能原地重算；请取消并重建计划");
  }
  const execution = plan.executions.find((row) => !row.cancelledAt);
  if (execution?.startedAt) {
    throw new Error("打样计划已开始制作，不能原地重算；请取消并重建计划");
  }

  const now = new Date();
  let releasedReservations = 0;
  if (execution) {
    const released = await tx.sampleInventoryReservation.updateMany({
      where: { executionId: execution.id, state: ReservationState.ACTIVE },
      data: { state: ReservationState.RELEASED },
    });
    releasedReservations = released.count;
    await tx.samplePlanExecutionStep.updateMany({
      where: { executionId: execution.id },
      data: { recalculatedAt: now },
    });
    await tx.samplePlanExecution.update({
      where: { id: execution.id },
      data: { cancelledAt: now },
    });
    await tx.samplePlan.update({
      where: { id },
      data: { approvedAt: null },
    });
  }

  const result = await calculatePlan(tx, scope, id);
  await recordAudit(tx, scope, "SAMPLE_PLAN_RECALCULATED", "SamplePlan", id, undefined, {
    previousExecutionId: execution?.id ?? null,
    releasedReservations,
    calculationGroupId: result.calculationGroupId,
    runIds: result.runs.map((run) => run.id),
    topRunId: result.runs[0]?.id ?? null,
    warnings: result.warnings,
  });
  return {
    ...result,
    releasedReservations,
    cancelledExecutionId: execution?.id ?? null,
  };
}

async function materialScales(
  tx: Prisma.TransactionClient,
  tenantId: string,
  materialIds: readonly string[],
): Promise<Map<string, { quantityScale: number; baseUnit: string }>> {
  const unique = [...new Set(materialIds)];
  if (unique.length === 0) return new Map();
  const materials = await tx.material.findMany({
    where: { id: { in: unique }, tenantId },
    select: { id: true, quantityScale: true, baseUnit: true },
  });
  return new Map(materials.map((material) => [
    material.id,
    { quantityScale: material.quantityScale, baseUnit: material.baseUnit },
  ]));
}

type ConsumptionRow = { batchId: string; quantity: number; unitCost: number; costEstimated: boolean; usableUntil: Date | null };

async function consumeProductionAcrossBatches(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  executionId: string,
  stepId: string,
  materialId: string,
  quantity: number,
  batchIds: readonly string[],
  idempotencySuffix: string,
): Promise<ConsumptionRow[]> {
  if (quantity <= EPSILON) return [];
  const production = await productionLocation(tx, scope.storeId);
  const unique = [...new Set(batchIds)].sort();
  let remaining = quantity;
  const rows: ConsumptionRow[] = [];
  for (const batchId of unique) {
    if (remaining <= EPSILON) break;
    await lockBatchRow(tx, batchId);
    await lockBatchBalances(tx, batchId);
    const batch = await tx.inventoryBatch.findFirst({
      where: { id: batchId, storeId: scope.storeId, materialId },
      include: {
        balances: { where: { locationId: production.id } },
        material: { select: { quantityScale: true } },
      },
    });
    if (!batch) throw new Error("打样物料批次不属于当前门店");
    const balance = batch.balances[0];
    if (!balance) continue;
    const available = Number(balance.onHandQty);
    const take = roundQty(Math.min(available, remaining));
    if (take <= EPSILON) continue;
    await tx.batchBalance.update({
      where: { id: balance.id },
      data: { onHandQty: { decrement: take } },
    });
    await tx.inventoryTransaction.create({
      data: {
        batchId,
        kind: TransactionKind.CONSUME,
        quantity: take,
        fromLocationId: production.id,
        referenceType: "SAMPLE_PLAN_EXECUTION",
        referenceId: executionId,
        idempotencyKey: `v2-sample-consume-${stepId}-${batchId}-${idempotencySuffix}`,
      },
    });
    rows.push({
      batchId,
      quantity: take,
      unitCost: Number(batch.unitCost),
      costEstimated: batch.costEstimated,
      usableUntil: batch.usableUntil,
    });
    remaining = roundQty(remaining - take);
  }
  if (remaining > EPSILON) {
    throw new Error("制作区实存不足或批次位置不明，需人工处理");
  }
  return rows;
}

export type CompleteSamplePlanStepResult = {
  stepId: string;
  planCompleted: boolean;
  usedQty: number;
  reusedQty: number;
  lostQty: number;
  reusableQty: number;
  actualCost: number;
  nextStepId: string | null;
};

export async function completeStep(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
  input: CompleteSamplePlanStepInput,
): Promise<CompleteSamplePlanStepResult> {
  assertScope(scope);
  const id = typeof planId === "string" ? planId.trim() : "";
  if (!id) throw new Error("打样计划标识不能为空");
  if (!Array.isArray(input.materials) || input.materials.length === 0) {
    throw new Error("请登记本步实际用量");
  }
  if (typeof input.disassemble !== "boolean") throw new Error("请明确本步是否拆解样品");
  const lossReason = input.lossReason?.trim() || "打样拆解损耗";

  await lockPlan(tx, id);
  await lockStoreRow(tx, scope.storeId);
  let execution = await loadExecution(tx, scope, id);
  if (execution.plan.state === SamplePlanState.PAUSED) {
    throw new Error("打样计划已暂停，请先恢复计划");
  }
  if (execution.plan.state === SamplePlanState.CANCELLED) {
    throw new Error("已取消的打样计划不能继续执行");
  }
  if (execution.plan.state === SamplePlanState.COMPLETED) {
    throw new Error("已完成的打样计划不能继续执行");
  }
  if (execution.plan.state !== SamplePlanState.APPROVED &&
      execution.plan.state !== SamplePlanState.IN_PROGRESS) {
    throw new Error("只有已批准的打样计划可以执行");
  }
  const started = await ensureCurrentStepStarted(tx, scope, id, execution);
  execution = await loadExecution(tx, scope, id);
  const step = execution.steps.find((row) => row.id === started.stepId && row.startedAt && !row.completedAt);
  if (!step) throw new Error("没有已开始且未完成的打样步骤");
  const sequenceNo = step.plannedStep.sequenceNo;
  const isLast = !execution.steps.some((row) => row.plannedStep.sequenceNo > sequenceNo);
  if (!input.disassemble && !isLast) {
    // Intermediate samples must be disassembled to release material for later steps.
    // This is a guided default, not a hard rule: the UI can still mark a keep decision.
  }

  const activeReservations = step.reservations.filter((row) => row.state === ReservationState.ACTIVE);
  if (activeReservations.length > 0) {
    throw new Error("本步还有未领用的预留，请先开始本步");
  }
  const reusedByMaterial = snapshotReusedByMaterial(step.actualReusableSnapshot);
  const issueByMaterial = new Map<string, number>();
  for (const reservation of step.reservations) {
    if (reservation.state !== ReservationState.ISSUED && reservation.state !== ReservationState.CONSUMED) continue;
    const materialId = reservation.batch.materialId;
    issueByMaterial.set(
      materialId,
      roundQty((issueByMaterial.get(materialId) ?? 0) + Number(reservation.quantity)),
    );
  }

  const inputByMaterial = new Map<string, { issued: number; reused: number; input: number }>();
  for (const flow of step.plannedStep.flows) {
    if (Number(flow.requiredQty) <= EPSILON) continue;
    const materialId = flow.materialId;
    const issued = issueByMaterial.get(materialId) ?? 0;
    const reused = reusedByMaterial[materialId] ?? 0;
    inputByMaterial.set(materialId, {
      issued,
      reused,
      input: roundQty(issued + reused),
    });
  }

  const seen = new Set<string>();
  const actualByMaterial = new Map<string, {
    usedQty: number;
    reusableQty: number;
    lostQty: number;
    reusableTotal: number;
    consumed: number;
  }>();
  for (const line of input.materials) {
    const materialId = typeof line?.materialId === "string" ? line.materialId.trim() : "";
    if (!materialId) throw new Error("实际用料缺少物料");
    if (seen.has(materialId)) throw new Error("同一物料不能重复登记实际用量");
    seen.add(materialId);
    const inputRow = inputByMaterial.get(materialId);
    if (!inputRow) throw new Error("实际用料包含本步不需要的物料");
    const usedQty = decimal(line.usedQty, "实际用量");
    const reusableQty = line.reusableQty === undefined ? 0 : decimal(line.reusableQty, "拆解可复用数量");
    if (usedQty > inputRow.input + EPSILON) {
      throw new Error("实际用量不能超过本步投入");
    }
    if (!input.disassemble && reusableQty > EPSILON) {
      throw new Error("未拆解样品时不能登记拆解可复用数量");
    }
    if (reusableQty > usedQty + EPSILON) {
      throw new Error("拆解可复用数量不能超过实际用量");
    }
    const lostQty = input.disassemble
      ? roundQty(usedQty - reusableQty)
      : 0;
    const unused = roundQty(inputRow.input - usedQty);
    const reusableTotal = roundQty(unused + (input.disassemble ? reusableQty : 0));
    const consumed = roundQty(usedQty - (input.disassemble ? reusableQty : 0));
    actualByMaterial.set(materialId, {
      usedQty: roundQty(usedQty),
      reusableQty: roundQty(reusableQty),
      lostQty,
      reusableTotal,
      consumed,
    });
  }
  for (const materialId of inputByMaterial.keys()) {
    if (!seen.has(materialId)) throw new Error("本步全部物料都需要登记实际用量");
  }

  const scales = await materialScales(
    tx,
    scope.tenantId,
    [...inputByMaterial.keys()],
  );
  for (const [materialId, actual] of actualByMaterial) {
    const scale = scales.get(materialId)?.quantityScale ?? 0;
    try {
      assertMaterialQuantity(actual.usedQty, scale);
      assertMaterialQuantity(actual.reusableQty, scale);
      assertMaterialQuantity(actual.lostQty, scale);
    } catch {
      throw new Error("实际用量不符合物料计量精度");
    }
  }

  let totalUsed = 0;
  let totalReused = 0;
  let totalLost = 0;
  let totalReusable = 0;
  let actualCost = 0;
  let costEstimated = false;
  const actualSnapshotMaterials: Record<string, unknown>[] = [];

  for (const [materialId, actual] of actualByMaterial) {
    const flow = step.plannedStep.flows.find((row) => row.materialId === materialId)!;
    const candidateBatchIds = [
      ...step.reservations
        .filter((row) => row.batch.materialId === materialId)
        .map((row) => row.batchId),
      ...execution.steps
        .filter((row) => row.completedAt && row.plannedStep.sequenceNo < sequenceNo)
        .flatMap((row) => row.disassembledMaterials
          .filter((material) => material.materialId === materialId)
          .map((material) => material.sourceBatchId)
          .filter((batchId): batchId is string => Boolean(batchId))),
    ];
    const consumedRows = await consumeProductionAcrossBatches(
      tx,
      scope,
      execution.id,
      step.id,
      materialId,
      actual.consumed,
      candidateBatchIds,
      materialId,
    );
    if (actual.lostQty > EPSILON) {
      await tx.lossRecord.create({
        data: {
          storeId: scope.storeId,
          batchId: consumedRows[0]?.batchId ?? null,
          materialId,
          locationId: null,
          orderId: null,
          reason: LossReason.PRODUCTION_ERROR,
          quantity: actual.lostQty,
          note: lossReason,
          submittedById: scope.actorStaffId,
        },
      });
    }
    if (actual.reusableTotal > EPSILON || actual.lostQty > EPSILON) {
      await tx.sampleDisassemblyMaterial.create({
        data: {
          executionStepId: step.id,
          materialId,
          sourceBatchId: consumedRows[0]?.batchId ?? candidateBatchIds[0] ?? null,
          usableQty: actual.reusableTotal,
          rejectedQty: actual.lostQty,
          usableUntil: consumedRows[0]?.usableUntil ?? null,
          checkedById: scope.actorStaffId,
        },
      });
    }
    for (const reservation of step.reservations) {
      if (reservation.batch.materialId !== materialId) continue;
      if (reservation.state !== ReservationState.ISSUED && reservation.state !== ReservationState.CONSUMED) continue;
      actualCost = roundMoney(actualCost + Number(reservation.quantity) * Number(reservation.batch.unitCost));
      costEstimated ||= reservation.batch.costEstimated;
    }
    totalUsed = roundQty(totalUsed + actual.usedQty);
    totalReused = roundQty(totalReused + (reusedByMaterial[materialId] ?? 0));
    totalLost = roundQty(totalLost + actual.lostQty);
    totalReusable = roundQty(totalReusable + actual.reusableTotal);
    actualSnapshotMaterials.push({
      materialId,
      materialNameSnapshot: flow.materialNameSnapshot,
      usedQty: actual.usedQty,
      reusedQty: reusedByMaterial[materialId] ?? 0,
      lostQty: actual.lostQty,
      reusableQty: actual.reusableTotal,
      consumedQty: actual.consumed,
    });
  }

  await tx.sampleInventoryReservation.updateMany({
    where: { executionStepId: step.id, state: ReservationState.ISSUED },
    data: { state: ReservationState.CONSUMED },
  });

  const completedAt = new Date();
  await tx.samplePlanExecutionStep.update({
    where: { id: step.id },
    data: {
      completedAt,
      usedQty: totalUsed,
      reusedQty: totalReused,
      lostQty: totalLost,
      returnedQty: 0,
      reusableQty: totalReusable,
      actualCost,
      costEstimated,
      actualReusableSnapshot: {
        reusedByMaterial,
        plannedRequiredByMaterial: Object.fromEntries(
          step.plannedStep.flows.map((flow) => [flow.materialId, Number(flow.requiredQty)]),
        ),
        materials: actualSnapshotMaterials,
        disassemble: input.disassemble,
      } as Prisma.InputJsonValue,
    },
  });

  const nextStep = execution.steps.find((row) => row.plannedStep.sequenceNo > sequenceNo && !row.completedAt);
  if (isLast) {
    const allSteps = await tx.samplePlanExecutionStep.findMany({
      where: { executionId: execution.id },
    });
    const totalCost = roundMoney(allSteps.reduce((sum, row) => sum + Number(row.actualCost), 0));
    await tx.samplePlanExecution.update({
      where: { id: execution.id },
      data: {
        completedAt,
        actualCost: totalCost,
        costEstimated: allSteps.some((row) => row.costEstimated),
      },
    });
    await tx.samplePlan.update({
      where: { id },
      data: { state: SamplePlanState.COMPLETED },
    });
    if (!input.disassemble) {
      await tx.sample.updateMany({
        where: { id: step.plannedStep.sampleId, tenantId: scope.tenantId, state: { not: SampleState.ARCHIVED } },
        data: { state: SampleState.READY },
      });
    }
    await recordAudit(tx, scope, "SAMPLE_PLAN_COMPLETED", "SamplePlan", id, undefined, {
      executionId: execution.id,
      stepId: step.id,
      totalCost,
      usedQty: totalUsed,
      reusedQty: totalReused,
      lostQty: totalLost,
      reusableQty: totalReusable,
      sampleRetained: !input.disassemble,
    });
  } else {
    await recordAudit(tx, scope, "SAMPLE_PLAN_STEP_COMPLETED", "SamplePlan", id, undefined, {
      executionId: execution.id,
      stepId: step.id,
      sequenceNo,
      usedQty: totalUsed,
      reusedQty: totalReused,
      lostQty: totalLost,
      reusableQty: totalReusable,
      nextStepId: nextStep?.id ?? null,
    });
  }

  return {
    stepId: step.id,
    planCompleted: isLast,
    usedQty: totalUsed,
    reusedQty: totalReused,
    lostQty: totalLost,
    reusableQty: totalReusable,
    actualCost,
    nextStepId: nextStep?.id ?? null,
  };
}

export type CancelSamplePlanResult = {
  planId: string;
  releasedReservations: number;
  returnedQty: number;
  keptQty: number;
  lostQty: number;
};

export async function cancelPlan(
  tx: Prisma.TransactionClient,
  scope: SamplePlanScope,
  planId: string,
  input: CancelSamplePlanInput,
): Promise<CancelSamplePlanResult> {
  assertScope(scope);
  const id = typeof planId === "string" ? planId.trim() : "";
  if (!id) throw new Error("打样计划标识不能为空");
  const reason = input.reason?.trim();
  if (!reason) throw new Error("取消原因必填");
  await lockPlan(tx, id);
  await lockStoreRow(tx, scope.storeId);
  const plan = await loadPlan(tx, scope, id);
  if (plan.state === SamplePlanState.COMPLETED) throw new Error("已完成的打样计划不能取消");
  if (plan.state === SamplePlanState.CANCELLED) throw new Error("打样计划已经取消");
  const execution = await tx.samplePlanExecution.findFirst({
    where: { planId: id, cancelledAt: null },
    orderBy: { approvedAt: "desc" },
    select: { id: true, startedAt: true },
  });
  if (!execution) {
    await tx.samplePlan.update({
      where: { id },
      data: { state: SamplePlanState.CANCELLED },
    });
    await recordAudit(tx, scope, "SAMPLE_PLAN_CANCELLED", "SamplePlan", id, undefined, {
      reason,
      releasedReservations: 0,
      returnedQty: 0,
      keptQty: 0,
      lostQty: 0,
    });
    return { planId: id, releasedReservations: 0, returnedQty: 0, keptQty: 0, lostQty: 0 };
  }

  const released = await tx.sampleInventoryReservation.updateMany({
    where: { executionId: execution.id, state: ReservationState.ACTIVE },
    data: { state: ReservationState.RELEASED },
  });

  let returnedQty = 0;
  let keptQty = 0;
  let lostQty = 0;
  let resolutionRows: ProductionDispositionResult["resolutions"] = [];
  if (execution.startedAt) {
    const outstanding = await outstandingProductionByBatch(tx, execution.id);
    const disposition = await resolveProductionDisposition(
      tx,
      scope,
      execution.id,
      outstanding,
      input.resolutions,
      {
        referenceType: "SAMPLE_PLAN_CANCELLATION",
        lossNote: reason,
        eventKey: `cancel-${randomUUID()}`,
        reduceReservations: false,
        adjustDisassemblyPool: false,
      },
    );
    returnedQty = disposition.returnedQty;
    keptQty = disposition.keptQty;
    lostQty = disposition.lostQty;
    resolutionRows = disposition.resolutions;
    await tx.sampleInventoryReservation.updateMany({
      where: { executionId: execution.id, state: { in: [ReservationState.ISSUED, ReservationState.CONSUMED] } },
      data: { state: ReservationState.RELEASED },
    });
  }

  await tx.samplePlanExecution.update({
    where: { id: execution.id },
    data: { cancelledAt: new Date() },
  });
  await tx.samplePlan.update({
    where: { id },
    data: { state: SamplePlanState.CANCELLED },
  });
  await recordAudit(tx, scope, "SAMPLE_PLAN_CANCELLED", "SamplePlan", id, undefined, {
    reason,
    executionId: execution.id,
    releasedReservations: released.count,
    returnedQty,
    keptQty,
    lostQty,
    resolutionCount: input.resolutions?.length ?? 0,
    resolutions: resolutionRows,
  });
  return { planId: id, releasedReservations: released.count, returnedQty, keptQty, lostQty };
}
