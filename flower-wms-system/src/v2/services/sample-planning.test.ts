import assert from "node:assert/strict";
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState,
  MaterialKind,
  OrderEntry,
  OrderItemKind,
  PrismaClient,
  ReservationState,
  SamplePlanState,
  SampleState,
  TransactionKind,
} from "../../generated/prisma-v2/client";
import {
  approvePlan,
  calculatePlan,
  cancelPlan,
  completeStep,
  createPlanFromRecommendation,
  loadSamplePlanRecommendations,
  pausePlan,
  recalculatePlan,
  resumePlan,
  saveSamplePlan,
  selectPlanRun,
  startNextStep,
  startPlan,
  type SamplePlanScope,
} from "./sample-planning";
import { getSampleReport } from "./sample-reporting";
import {
  confirmSampleMaterialSubstitution,
  loadSampleSubstitutionProposals,
} from "./sample-substitution";
import { reserveOrderMaterial } from "./reserve-order-material";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
const marker = crypto.randomUUID().slice(0, 8);
const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

let tenantId: string | undefined;

async function cleanup(db: PrismaClient): Promise<void> {
  if (!tenantId) return;
  const tenants = { tenantId };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.inventoryReservation.deleteMany({
    where: { requirement: { orderItem: { order: tenants } } },
  });
  await db.sampleInventoryReservation.deleteMany({
    where: { execution: { plan: tenants } },
  });
  await db.inventoryTransaction.deleteMany({
    where: { batch: { store: tenants } },
  });
  await db.sampleDisassemblyMaterial.deleteMany({
    where: { executionStep: { execution: { plan: tenants } } },
  });
  await db.samplePlanExecutionStep.deleteMany({
    where: { execution: { plan: tenants } },
  });
  await db.samplePlanExecution.deleteMany({ where: { plan: tenants } });
  await db.samplePlanStepMaterial.deleteMany({ where: { step: { run: { plan: tenants } } } });
  await db.samplePlanStep.deleteMany({ where: { run: { plan: tenants } } });
  await db.samplePlanInventorySnapshot.deleteMany({ where: { run: { plan: tenants } } });
  await db.samplePlanRun.deleteMany({ where: { plan: tenants } });
  await db.samplePlanMaterial.deleteMany({ where: { plan: tenants } });
  await db.samplePlanItem.deleteMany({ where: { plan: tenants } });
  await db.samplePlan.deleteMany({ where: tenants });
  await db.sampleMaterialSubstitution.deleteMany({ where: { sample: tenants } });
  await db.sampleMaterial.deleteMany({ where: { sample: tenants } });
  await db.sample.deleteMany({ where: tenants });
  await db.orderMaterialRequirement.deleteMany({
    where: { orderItem: { order: tenants } },
  });
  await db.orderRevision.deleteMany({ where: { order: tenants } });
  await db.orderItem.deleteMany({ where: { order: tenants } });
  await db.order.deleteMany({ where: tenants });
  await db.batchBalance.deleteMany({ where: { batch: { store: tenants } } });
  await db.lossRecord.deleteMany({ where: { store: tenants } });
  await db.inventoryBatch.deleteMany({ where: { store: tenants } });
  await db.material.deleteMany({ where: tenants });
  await db.inventoryLocation.deleteMany({ where: { store: tenants } });
  await db.store.deleteMany({ where: tenants });
  await db.tenant.deleteMany({ where: { id: tenantId } });
}

async function makeSample(
  db: PrismaClient,
  input: { code: string; name: string; materialId: string; quantity: number },
) {
  return db.sample.create({
    data: {
      tenantId: tenantId!,
      code: input.code,
      name: input.name,
      state: SampleState.READY,
      targetMarginRate: "0.5000",
      materials: { create: [{ materialId: input.materialId, quantity: input.quantity }] },
    },
  });
}

async function makeBatch(
  db: PrismaClient,
  input: { id?: string; storeId: string; locationId: string; materialId: string; batchNo: string; quantity: number; unitCost: number },
) {
  return db.inventoryBatch.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      storeId: input.storeId,
      materialId: input.materialId,
      batchNo: input.batchNo,
      receivedAt: new Date("2026-01-01T00:00:00.000Z"),
      usableUntil: future,
      unitCost: input.unitCost,
      costEstimated: false,
      balances: { create: [{ locationId: input.locationId, onHandQty: input.quantity }] },
    },
  });
}

async function run(): Promise<void> {
  if (!connectionString) {
    console.log("v2 sample planning DB test skipped (no V2_DATABASE_URL/DATABASE_URL)");
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const tenant = await db.tenant.create({
      data: { slug: `sprint4-plan-${marker}`, name: "Sprint 4 打样测试租户" },
    });
    tenantId = tenant.id;
    const store = await db.store.create({
      data: { tenantId, code: "MAIN", name: "Sprint 4 打样测试店" },
    });
    const warehouse = await db.inventoryLocation.create({
      data: { storeId: store.id, code: "WH", kind: "WAREHOUSE" },
    });
    const production = await db.inventoryLocation.create({
      data: { storeId: store.id, code: "PROD", kind: "PRODUCTION" },
    });
    const flower = await db.material.create({
      data: {
        tenantId,
        code: `S4-PLAN-ROSE-${marker}`,
        name: "打样红玫瑰",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        standardUsableRate: "0.5000",
        active: true,
      },
    });
    const batch = await makeBatch(db, {
      storeId: store.id,
      locationId: warehouse.id,
      materialId: flower.id,
      batchNo: `BATCH-A-${marker}`,
      quantity: 12,
      unitCost: 2,
    });
    const sampleA = await makeSample(db, {
      code: `SMP-A-${marker}`,
      name: "样品 A",
      materialId: flower.id,
      quantity: 10,
    });
    const sampleB = await makeSample(db, {
      code: `SMP-B-${marker}`,
      name: "样品 B",
      materialId: flower.id,
      quantity: 6,
    });
    const scope: SamplePlanScope = {
      tenantId,
      storeId: store.id,
      actorStaffId: "staff-sample-plan-test",
    };

    const plan = await db.$transaction((tx) => saveSamplePlan(tx, scope, {
      name: "Sprint 4 两样品计划",
      items: [
        { sampleId: sampleA.id, quantity: 1, mandatory: true, sequenceNo: 1 },
        { sampleId: sampleB.id, quantity: 1, mandatory: true, sequenceNo: 2 },
      ],
    }));
    const calculated = await db.$transaction((tx) => calculatePlan(tx, scope, plan.id), { timeout: 30_000 });
    assert.equal(calculated.runs.length, 1);
    assert.equal(calculated.runs[0]!.totalCost, 20);
    assert.equal(calculated.runs[0]!.estimatedSaving, 12);
    const storedPlan = await db.samplePlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: {
        runs: {
          include: {
            steps: { include: { flows: true }, orderBy: { sequenceNo: "asc" } },
          },
        },
      },
    });
    assert.equal(storedPlan.state, SamplePlanState.PROPOSED);
    assert.equal(storedPlan.runs.length, 1);
    assert.ok(storedPlan.selectedRunId);
    const selectedRun = storedPlan.runs[0]!;
    assert.equal(selectedRun.algorithmVersion, "sample-plan-v4-batch2");
    assert.equal(Number(selectedRun.steps[1]!.flows[0]!.reusedQty), 6);
    assert.equal(Number(selectedRun.steps[1]!.flows[0]!.purchaseQty), 0);

    const approved = await db.$transaction((tx) => approvePlan(tx, scope, plan.id), { timeout: 30_000 });
    assert.equal(approved.reservedQty, 10);
    assert.equal(approved.shortageQty, 0);
    const afterApprove = await db.samplePlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: {
        executions: {
          include: {
            steps: { include: { reservations: true }, orderBy: { plannedStep: { sequenceNo: "asc" } } },
          },
        },
      },
    });
    assert.equal(afterApprove.state, SamplePlanState.APPROVED);
    assert.equal(afterApprove.executions.length, 1);
    const execution = afterApprove.executions[0]!;
    assert.equal(execution.steps[0]!.reservations.length, 1);
    assert.equal(Number(execution.steps[0]!.reservations[0]!.quantity), 10);
    assert.equal(execution.steps[1]!.reservations.length, 0, "approval reserves only the first step");

    const started = await db.$transaction((tx) => startPlan(tx, scope, plan.id), { timeout: 30_000 });
    assert.equal(started.issuedQty, 10);
    const warehouseAfterStart = await db.batchBalance.findFirstOrThrow({
      where: { batchId: batch.id, locationId: warehouse.id },
    });
    const productionAfterStart = await db.batchBalance.findFirstOrThrow({
      where: { batchId: batch.id, locationId: production.id },
    });
    assert.equal(Number(warehouseAfterStart.onHandQty), 2);
    assert.equal(Number(productionAfterStart.onHandQty), 10);

    const step1 = await db.$transaction((tx) => completeStep(tx, scope, plan.id, {
      materials: [{ materialId: flower.id, usedQty: 10, reusableQty: 5 }],
      disassemble: true,
      lossReason: "修剪损耗",
    }), { timeout: 30_000 });
    assert.equal(step1.planCompleted, false);
    assert.equal(step1.lostQty, 5);
    assert.equal(step1.reusableQty, 5);
    assert.equal(step1.actualCost, 20);
    const disassembly = await db.sampleDisassemblyMaterial.findMany({
      where: { executionStep: { executionId: execution.id } },
    });
    assert.equal(disassembly.length, 1);
    assert.equal(Number(disassembly[0]!.usableQty), 5);
    assert.equal(Number(disassembly[0]!.rejectedQty), 5);

    const next = await db.$transaction((tx) => startNextStep(tx, scope, plan.id), { timeout: 30_000 });
    assert.equal(next.reusedQty, 5);
    assert.equal(next.issuedQty, 1);
    const productionBeforeFinal = await db.batchBalance.findFirstOrThrow({
      where: { batchId: batch.id, locationId: production.id },
    });
    assert.equal(Number(productionBeforeFinal.onHandQty), 6);

    const step2 = await db.$transaction((tx) => completeStep(tx, scope, plan.id, {
      materials: [{ materialId: flower.id, usedQty: 6 }],
      disassemble: false,
    }), { timeout: 30_000 });
    assert.equal(step2.planCompleted, true);
    assert.equal(step2.actualCost, 2);
    const finalPlan = await db.samplePlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { executions: true },
    });
    assert.equal(finalPlan.state, SamplePlanState.COMPLETED);
    assert.equal(Number(finalPlan.executions[0]!.actualCost), 22);
    const finalSampleB = await db.sample.findUniqueOrThrow({ where: { id: sampleB.id } });
    assert.equal(finalSampleB.state, SampleState.READY);
    const finalBatches = await db.batchBalance.findMany({ where: { batchId: batch.id } });
    assert.equal(finalBatches.reduce((sum, row) => sum + Number(row.onHandQty), 0), 1);
    const transactions = await db.inventoryTransaction.findMany({ where: { batchId: batch.id } });
    assert.equal(transactions.filter((row) => row.kind === TransactionKind.TRANSFER).length, 2);
    assert.equal(transactions.filter((row) => row.kind === TransactionKind.CONSUME).length, 2);
    const reservations = await db.sampleInventoryReservation.findMany({
      where: { executionId: execution.id },
    });
    assert.ok(reservations.every((row) => row.state === ReservationState.CONSUMED));

    const report = await getSampleReport(db, { tenantId, storeId: store.id });
    assert.equal(report.summary.planCount, 1);
    assert.equal(report.summary.completedPlanCount, 1);
    assert.equal(report.summary.plannedCost, 20);
    assert.equal(report.summary.actualCost, 22);
    assert.ok(report.summary.plannedReuseRate > 0);
    assert.ok((report.summary.actualReuseRate ?? 0) > 0);

    // Flower three-level classification only reorders optional suggestions:
    // a candidate with a different materialId but the same 种类+颜色+商品名 is
    // recommended, yet its reusedQty stays 0 because reuse still requires the
    // exact same material (WMS-BR-SMP-001/002).
    const classifiedMandatoryMaterial = await db.material.create({
      data: {
        tenantId,
        code: `S4-PLAN-CLASS-A-${marker}`,
        name: "分类打样玫瑰",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        standardUsableRate: "0.5000",
        color: "红",
        flowerVariety: "玫瑰",
        flowerProductName: "玛格丽特",
        active: true,
      },
    });
    const classifiedCandidateMaterial = await db.material.create({
      data: {
        tenantId,
        code: `S4-PLAN-CLASS-B-${marker}`,
        name: "同分类另一支玫瑰",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        standardUsableRate: "0.5000",
        color: "红",
        flowerVariety: "玫瑰",
        flowerProductName: "玛格丽特",
        active: true,
      },
    });
    await makeBatch(db, {
      storeId: store.id,
      locationId: warehouse.id,
      materialId: classifiedMandatoryMaterial.id,
      batchNo: `BATCH-CLASS-${marker}`,
      quantity: 20,
      unitCost: 2,
    });
    const classifiedSampleX = await makeSample(db, {
      code: `SMP-CLASS-X-${marker}`,
      name: "分类样品 X",
      materialId: classifiedMandatoryMaterial.id,
      quantity: 10,
    });
    const classifiedSampleY = await makeSample(db, {
      code: `SMP-CLASS-Y-${marker}`,
      name: "分类样品 Y",
      materialId: classifiedCandidateMaterial.id,
      quantity: 5,
    });
    const classifiedPlan = await db.$transaction((tx) => saveSamplePlan(tx, scope, {
      name: "分类推荐测试",
      items: [{ sampleId: classifiedSampleX.id, quantity: 1, mandatory: true, sequenceNo: 1 }],
    }));
    await db.$transaction((tx) => calculatePlan(tx, scope, classifiedPlan.id), { timeout: 30_000 });
    const classifiedRuns = await db.samplePlanRun.findMany({
      where: { planId: classifiedPlan.id },
      include: { steps: { include: { flows: true }, orderBy: { sequenceNo: "asc" } } },
    });
    const classifiedBaseRun = classifiedRuns.find((run) => {
      const snapshot = run.candidateSnapshot as { suggestedSampleIds?: string[] };
      return (snapshot.suggestedSampleIds?.length ?? 0) === 0;
    });
    assert.ok(classifiedBaseRun, "the plan must keep its mandatory-only run");
    assert.equal(Number(classifiedBaseRun!.totalCost), 20);
    const classifiedSuggestedRun = classifiedRuns.find((run) => {
      const snapshot = run.candidateSnapshot as { suggestedSampleIds?: string[] };
      return snapshot.suggestedSampleIds?.includes(classifiedSampleY.id) ?? false;
    });
    assert.ok(classifiedSuggestedRun, "same flower classification must suggest the candidate");
    const classifiedSnapshot = classifiedSuggestedRun!.candidateSnapshot as {
      suggestedSampleIds: string[];
      suggestedSampleReasons: {
        sampleId: string;
        overlap: number;
        exactClass: number;
        varietyColor: number;
      }[];
    };
    assert.deepEqual(classifiedSnapshot.suggestedSampleIds, [classifiedSampleY.id]);
    assert.equal(classifiedSnapshot.suggestedSampleReasons[0]?.sampleId, classifiedSampleY.id);
    assert.equal(classifiedSnapshot.suggestedSampleReasons[0]?.exactClass, 1);
    assert.equal(classifiedSnapshot.suggestedSampleReasons[0]?.varietyColor, 0);
    assert.equal(classifiedSnapshot.suggestedSampleReasons[0]?.overlap, 0);
    const classifiedCandidateStep = classifiedSuggestedRun!.steps[1]!;
    assert.equal(classifiedCandidateStep.sampleId, classifiedSampleY.id);
    assert.equal(Number(classifiedCandidateStep.flows[0]!.reusedQty), 0);
    assert.equal(Number(classifiedCandidateStep.flows[0]!.purchaseQty), 5);

    // A confirmed customer order reservation reduces what the plan may reserve.
    await db.sample.update({ where: { id: sampleB.id }, data: { state: SampleState.ARCHIVED } });
    const orderBatch = await makeBatch(db, {
      storeId: store.id,
      locationId: warehouse.id,
      materialId: flower.id,
      batchNo: `BATCH-ORDER-${marker}`,
      quantity: 10,
      unitCost: 2,
    });
    const order = await db.order.create({
      data: {
        tenantId,
        storeId: store.id,
        number: `ORD-S4-${marker}`,
        createdVia: OrderEntry.STAFF_PORTAL,
        sourceChannel: "staff",
        commercialState: CommercialState.CONFIRMED,
      },
    });
    const item = await db.orderItem.create({
      data: {
        orderId: order.id,
        kind: OrderItemKind.STANDARD,
        nameSnapshot: "顾客订单",
        quantity: 1,
        unitPrice: 100,
      },
    });
    const revision = await db.orderRevision.create({
      data: { orderId: order.id, number: 1 },
    });
    const requirement = await db.orderMaterialRequirement.create({
      data: {
        orderItemId: item.id,
        revisionId: revision.id,
        materialId: flower.id,
        plannedQty: 6,
        needBy: future,
      },
    });
    await db.inventoryReservation.create({
      data: {
        requirementId: requirement.id,
        batchId: orderBatch.id,
        quantity: 6,
        state: ReservationState.ACTIVE,
      },
    });

    const conflictPlan = await db.$transaction((tx) => saveSamplePlan(tx, scope, {
      name: "顾客订单优先测试",
      items: [{ sampleId: sampleA.id, quantity: 1, mandatory: true, sequenceNo: 1 }],
    }));
    await db.$transaction((tx) => calculatePlan(tx, scope, conflictPlan.id), { timeout: 30_000 });
    const conflictApproved = await db.$transaction(
      (tx) => approvePlan(tx, scope, conflictPlan.id),
      { timeout: 30_000 },
    );
    assert.ok(conflictApproved.reservedQty < 10, "customer order reservation must reduce plan reservation");
    await assert.rejects(
      db.$transaction((tx) => startPlan(tx, scope, conflictPlan.id), { timeout: 30_000 }),
      /首次制作缺料/,
    );
    await db.$transaction((tx) => cancelPlan(tx, scope, conflictPlan.id, {
      reason: "顾客订单优先，改期打样",
    }), { timeout: 30_000 });
    const cancelledConflict = await db.samplePlan.findUniqueOrThrow({ where: { id: conflictPlan.id } });
    assert.equal(cancelledConflict.state, SamplePlanState.CANCELLED);

    // After an actual disassembly yields less than forecast, the next step must
    // stop and ask for purchase/re-plan instead of continuing the old promise.
    const flower2 = await db.material.create({
      data: {
        tenantId,
        code: `S4-PLAN-TULIP-${marker}`,
        name: "打样郁金香",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        standardUsableRate: "0.5000",
        active: true,
      },
    });
    const shortageBatch = await makeBatch(db, {
      storeId: store.id,
      locationId: warehouse.id,
      materialId: flower2.id,
      batchNo: `BATCH-SHORT-${marker}`,
      quantity: 10,
      unitCost: 2,
    });
    const sampleC = await makeSample(db, {
      code: `SMP-C-${marker}`,
      name: "样品 C",
      materialId: flower2.id,
      quantity: 10,
    });
    const sampleD = await makeSample(db, {
      code: `SMP-D-${marker}`,
      name: "样品 D",
      materialId: flower2.id,
      quantity: 6,
    });
    const shortagePlan = await db.$transaction((tx) => saveSamplePlan(tx, scope, {
      name: "实际拆解不足测试",
      items: [
        { sampleId: sampleC.id, quantity: 1, mandatory: true, sequenceNo: 1 },
        { sampleId: sampleD.id, quantity: 1, mandatory: true, sequenceNo: 2 },
      ],
    }));
    await db.$transaction((tx) => calculatePlan(tx, scope, shortagePlan.id), { timeout: 30_000 });
    await db.$transaction((tx) => approvePlan(tx, scope, shortagePlan.id), { timeout: 30_000 });
    await db.$transaction((tx) => startPlan(tx, scope, shortagePlan.id), { timeout: 30_000 });
    await db.$transaction((tx) => completeStep(tx, scope, shortagePlan.id, {
      materials: [{ materialId: flower2.id, usedQty: 10, reusableQty: 2 }],
      disassemble: true,
      lossReason: "实际可复用低于预测",
    }), { timeout: 30_000 });
    await assert.rejects(
      db.$transaction((tx) => startNextStep(tx, scope, shortagePlan.id), { timeout: 30_000 }),
      /实际拆解后余下步骤缺料/,
    );
    const cancelledShortage = await db.$transaction((tx) => cancelPlan(tx, scope, shortagePlan.id, {
      reason: "实际复用不足，缩减计划",
      resolutions: [{
        batchId: shortageBatch.id,
        returnQty: 0,
        lossQty: 2,
        reverified: false,
        usableUntil: null,
      }],
    }), { timeout: 30_000 });
    assert.equal(cancelledShortage.lostQty, 2);
    const cancelledPlan = await db.samplePlan.findUniqueOrThrow({ where: { id: shortagePlan.id } });
    assert.equal(cancelledPlan.state, SamplePlanState.CANCELLED);

    // A confirmed customer order can preempt active reservations of an approved
    // but not-yet-started sample plan; the plan is marked at risk by audit.
    const flower3 = await db.material.create({
      data: {
        tenantId,
        code: `S4-PLAN-LILY-${marker}`,
        name: "打样百合",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        standardUsableRate: "0.5000",
        active: true,
      },
    });
    await makeBatch(db, {
      storeId: store.id,
      locationId: warehouse.id,
      materialId: flower3.id,
      batchNo: `BATCH-PRIORITY-${marker}`,
      quantity: 10,
      unitCost: 2,
    });
    const sampleE = await makeSample(db, {
      code: `SMP-E-${marker}`,
      name: "样品 E",
      materialId: flower3.id,
      quantity: 10,
    });
    const priorityPlan = await db.$transaction((tx) => saveSamplePlan(tx, scope, {
      name: "顾客订单抢占测试",
      items: [{ sampleId: sampleE.id, quantity: 1, mandatory: true, sequenceNo: 1 }],
    }));
    await db.$transaction((tx) => calculatePlan(tx, scope, priorityPlan.id), { timeout: 30_000 });
    await db.$transaction((tx) => approvePlan(tx, scope, priorityPlan.id), { timeout: 30_000 });
    const priorityExecution = await db.samplePlanExecution.findFirstOrThrow({
      where: { planId: priorityPlan.id, cancelledAt: null },
      include: { steps: { include: { reservations: true } } },
    });
    assert.ok(priorityExecution.steps[0]!.reservations.some((row) => row.state === ReservationState.ACTIVE));

    const priorityOrder = await db.order.create({
      data: {
        tenantId,
        storeId: store.id,
        number: `ORD-PRIORITY-${marker}`,
        createdVia: OrderEntry.STAFF_PORTAL,
        sourceChannel: "staff",
        commercialState: CommercialState.CONFIRMED,
      },
    });
    const priorityItem = await db.orderItem.create({
      data: {
        orderId: priorityOrder.id,
        kind: OrderItemKind.STANDARD,
        nameSnapshot: "优先顾客订单",
        quantity: 1,
        unitPrice: 100,
      },
    });
    const priorityRevision = await db.orderRevision.create({
      data: { orderId: priorityOrder.id, number: 1 },
    });
    const priorityRequirement = await db.orderMaterialRequirement.create({
      data: {
        orderItemId: priorityItem.id,
        revisionId: priorityRevision.id,
        materialId: flower3.id,
        plannedQty: 4,
        needBy: future,
      },
    });
    const priorityReservation = await db.$transaction(
      (tx) => reserveOrderMaterial(tx, priorityRequirement.id),
      { timeout: 30_000 },
    );
    assert.equal(priorityReservation.reserved, 4);
    assert.equal(priorityReservation.shortage, 0);
    const prioritySampleReservations = await db.sampleInventoryReservation.findMany({
      where: { executionId: priorityExecution.id },
    });
    assert.ok(prioritySampleReservations.every((row) => row.state === ReservationState.RELEASED));
    const riskAudit = await db.auditEvent.findFirst({
      where: { tenantId, entityType: "SamplePlan", entityId: priorityPlan.id, action: "SAMPLE_PLAN_AT_RISK" },
    });
    assert.ok(riskAudit);
    assert.equal((riskAudit.afterSnapshot as { reason?: string } | null)?.reason, "CUSTOMER_ORDER_PRIORITY");
    await assert.rejects(
      db.$transaction((tx) => startPlan(tx, scope, priorityPlan.id), { timeout: 30_000 }),
      /首次制作缺料/,
    );
    await db.$transaction((tx) => cancelPlan(tx, scope, priorityPlan.id, {
      reason: "顾客订单优先，打样改期",
    }), { timeout: 30_000 });

    // Sprint 4 closure: pause releases unissued reservations, resume re-checks
    // stock, and direct completion performs the verifiable issue transfer that
    // the separate "start" action would have done.
    const flower4 = await db.material.create({
      data: {
        tenantId,
        code: `S4-PLAN-ORCHID-${marker}`,
        name: "打样兰花",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        standardUsableRate: "0.5000",
        active: true,
      },
    });
    const pauseBatch = await makeBatch(db, {
      storeId: store.id,
      locationId: warehouse.id,
      materialId: flower4.id,
      batchNo: `BATCH-PAUSE-${marker}`,
      quantity: 12,
      unitCost: 2,
    });
    const sampleF = await makeSample(db, {
      code: `SMP-F-${marker}`,
      name: "样品 F",
      materialId: flower4.id,
      quantity: 10,
    });
    const sampleG = await makeSample(db, {
      code: `SMP-G-${marker}`,
      name: "样品 G",
      materialId: flower4.id,
      quantity: 6,
    });
    const pauseTestPlan = await db.$transaction((tx) => saveSamplePlan(tx, scope, {
      name: "暂停与直接完成测试",
      items: [
        { sampleId: sampleF.id, quantity: 1, mandatory: true, sequenceNo: 1 },
        { sampleId: sampleG.id, quantity: 1, mandatory: true, sequenceNo: 2 },
      ],
    }));
    await db.$transaction((tx) => calculatePlan(tx, scope, pauseTestPlan.id), { timeout: 30_000 });
    await db.$transaction((tx) => approvePlan(tx, scope, pauseTestPlan.id), { timeout: 30_000 });

    const pausedBeforeStart = await db.$transaction(
      (tx) => pausePlan(tx, scope, pauseTestPlan.id),
      { timeout: 30_000 },
    );
    assert.equal(pausedBeforeStart.releasedReservations, 1);
    assert.equal(pausedBeforeStart.releasedQty, 10);
    assert.equal(pausedBeforeStart.issuedKeptQty, 0);
    assert.equal(pausedBeforeStart.wasStarted, false);
    const pausedPlanRow = await db.samplePlan.findUniqueOrThrow({ where: { id: pauseTestPlan.id } });
    assert.equal(pausedPlanRow.state, SamplePlanState.PAUSED);
    const reservationsAfterPause = await db.sampleInventoryReservation.findMany({
      where: { execution: { planId: pauseTestPlan.id } },
    });
    assert.ok(reservationsAfterPause.length > 0);
    assert.ok(reservationsAfterPause.every((row) => row.state === ReservationState.RELEASED));
    await assert.rejects(
      db.$transaction((tx) => startPlan(tx, scope, pauseTestPlan.id), { timeout: 30_000 }),
      /只有已批准/,
    );
    const resumedBeforeStart = await db.$transaction(
      (tx) => resumePlan(tx, scope, pauseTestPlan.id),
      { timeout: 30_000 },
    );
    assert.equal(resumedBeforeStart.state, SamplePlanState.APPROVED);
    assert.equal(resumedBeforeStart.reservedQty, 10);
    assert.equal(resumedBeforeStart.shortageQty, 0);
    assert.ok(await db.auditEvent.findFirst({
      where: { entityId: pauseTestPlan.id, action: "SAMPLE_PLAN_PAUSED" },
    }), "pause must leave an audit trail");
    assert.ok(await db.auditEvent.findFirst({
      where: { entityId: pauseTestPlan.id, action: "SAMPLE_PLAN_RESUMED" },
    }), "resume must leave an audit trail");

    const directStep1 = await db.$transaction((tx) => completeStep(tx, scope, pauseTestPlan.id, {
      materials: [{ materialId: flower4.id, usedQty: 10, reusableQty: 5 }],
      disassemble: true,
      lossReason: "直接完成自动领料",
    }), { timeout: 30_000 });
    assert.equal(directStep1.planCompleted, false);
    assert.equal(directStep1.actualCost, 20);
    assert.ok(await db.auditEvent.findFirst({
      where: { entityId: pauseTestPlan.id, action: "SAMPLE_PLAN_STARTED" },
    }), "direct completion must record the auto start audit");

    const pausedInProgress = await db.$transaction(
      (tx) => pausePlan(tx, scope, pauseTestPlan.id, {
        resolutions: [{
          batchId: pauseBatch.id,
          returnQty: 0,
          keepQty: 5,
          lossQty: 0,
        }],
      }),
      { timeout: 30_000 },
    );
    assert.equal(pausedInProgress.releasedReservations, 0);
    assert.equal(pausedInProgress.releasedQty, 0);
    assert.equal(pausedInProgress.issuedKeptQty, 5);
    assert.equal(pausedInProgress.returnedQty, 0);
    assert.equal(pausedInProgress.keptQty, 5);
    assert.equal(pausedInProgress.lostQty, 0);
    assert.equal(pausedInProgress.wasStarted, true);
    const midPlan = await db.samplePlan.findUniqueOrThrow({ where: { id: pauseTestPlan.id } });
    assert.equal(midPlan.state, SamplePlanState.PAUSED);
    await assert.rejects(
      db.$transaction((tx) => completeStep(tx, scope, pauseTestPlan.id, {
        materials: [{ materialId: flower4.id, usedQty: 6 }],
        disassemble: false,
      }), { timeout: 30_000 }),
      /已暂停/,
    );
    const resumedInProgress = await db.$transaction(
      (tx) => resumePlan(tx, scope, pauseTestPlan.id),
      { timeout: 30_000 },
    );
    assert.equal(resumedInProgress.state, SamplePlanState.IN_PROGRESS);

    const directStep2 = await db.$transaction((tx) => completeStep(tx, scope, pauseTestPlan.id, {
      materials: [{ materialId: flower4.id, usedQty: 6 }],
      disassemble: false,
    }), { timeout: 30_000 });
    assert.equal(directStep2.planCompleted, true);
    assert.equal(directStep2.actualCost, 2);
    const directFinished = await db.samplePlan.findUniqueOrThrow({ where: { id: pauseTestPlan.id } });
    assert.equal(directFinished.state, SamplePlanState.COMPLETED);
    const directExecution = await db.samplePlanExecution.findFirstOrThrow({
      where: { planId: pauseTestPlan.id, cancelledAt: null },
    });
    const directTransfers = await db.inventoryTransaction.count({
      where: {
        referenceId: directExecution.id,
        referenceType: "SAMPLE_PLAN_EXECUTION",
        kind: TransactionKind.TRANSFER,
      },
    });
    assert.equal(directTransfers, 2, "direct completion must issue first and later step material");
    assert.ok(await db.auditEvent.findFirst({
      where: { entityId: pauseTestPlan.id, action: "SAMPLE_PLAN_STEP_STARTED" },
    }), "direct completion of a later step must record the auto start audit");
    assert.equal(
      Number((await db.batchBalance.findFirstOrThrow({
        where: { batchId: pauseBatch.id, locationId: warehouse.id },
      })).onHandQty),
      1,
    );

    // WMS-BR-SMP-007: pausing while a step is in progress must capture an
    // explicit return/keep/write-off decision for the material in production.
    const flowerPauseDispose = await db.material.create({
      data: {
        tenantId,
        code: `S4-PLAN-DISPOSE-${marker}`,
        name: "暂停处置花材",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        standardUsableRate: "0.5000",
        active: true,
      },
    });
    const disposalBatch = await makeBatch(db, {
      storeId: store.id,
      locationId: warehouse.id,
      materialId: flowerPauseDispose.id,
      batchNo: `BATCH-DISPOSE-${marker}`,
      quantity: 13,
      unitCost: 2,
    });
    const sampleDispose = await makeSample(db, {
      code: `SMP-DISPOSE-${marker}`,
      name: "暂停处置样品",
      materialId: flowerPauseDispose.id,
      quantity: 10,
    });
    const disposalPlan = await db.$transaction((tx) => saveSamplePlan(tx, scope, {
      name: "暂停制作区实物处置测试",
      items: [{ sampleId: sampleDispose.id, quantity: 1, mandatory: true, sequenceNo: 1 }],
    }));
    await db.$transaction((tx) => calculatePlan(tx, scope, disposalPlan.id), { timeout: 30_000 });
    await db.$transaction((tx) => approvePlan(tx, scope, disposalPlan.id), { timeout: 30_000 });
    await db.$transaction((tx) => startPlan(tx, scope, disposalPlan.id), { timeout: 30_000 });
    assert.equal(
      Number((await db.batchBalance.findFirstOrThrow({
        where: { batchId: disposalBatch.id, locationId: warehouse.id },
      })).onHandQty),
      3,
    );
    assert.equal(
      Number((await db.batchBalance.findFirstOrThrow({
        where: { batchId: disposalBatch.id, locationId: production.id },
      })).onHandQty),
      10,
    );

    await assert.rejects(
      db.$transaction((tx) => pausePlan(tx, scope, disposalPlan.id, {
        resolutions: [{
          batchId: disposalBatch.id,
          returnQty: 1,
          keepQty: 1,
          lossQty: 1,
        }],
      }), { timeout: 30_000 }),
      /必须等于未处理数量/,
    );
    await assert.rejects(
      db.$transaction((tx) => pausePlan(tx, scope, disposalPlan.id, {
        resolutions: [{
          batchId: disposalBatch.id,
          returnQty: 4,
          keepQty: 6,
          lossQty: 0,
        }],
      }), { timeout: 30_000 }),
      /重新验收/,
    );

    const pausedWithDisposition = await db.$transaction(
      (tx) => pausePlan(tx, scope, disposalPlan.id, {
        resolutions: [{
          batchId: disposalBatch.id,
          returnQty: 4,
          keepQty: 4,
          lossQty: 2,
          reverified: true,
          usableUntil: future,
        }],
      }),
      { timeout: 30_000 },
    );
    assert.equal(pausedWithDisposition.returnedQty, 4);
    assert.equal(pausedWithDisposition.keptQty, 4);
    assert.equal(pausedWithDisposition.lostQty, 2);
    assert.equal(pausedWithDisposition.issuedKeptQty, 4);
    assert.equal(
      Number((await db.batchBalance.findFirstOrThrow({
        where: { batchId: disposalBatch.id, locationId: warehouse.id },
      })).onHandQty),
      7,
    );
    assert.equal(
      Number((await db.batchBalance.findFirstOrThrow({
        where: { batchId: disposalBatch.id, locationId: production.id },
      })).onHandQty),
      4,
    );
    const disposalLoss = await db.lossRecord.findFirstOrThrow({
      where: { batchId: disposalBatch.id, storeId: store.id },
    });
    assert.equal(Number(disposalLoss.quantity), 2);
    const pauseDispositionAudit = await db.auditEvent.findFirstOrThrow({
      where: { entityId: disposalPlan.id, action: "SAMPLE_PLAN_PAUSED" },
      orderBy: { occurredAt: "desc" },
    });
    const pauseSnapshot = pauseDispositionAudit.afterSnapshot as {
      resolutions?: { batchId: string; returnQty: number; keepQty: number; lossQty: number }[];
    } | null;
    assert.equal(pauseSnapshot?.resolutions?.[0]?.returnQty, 4);
    assert.equal(pauseSnapshot?.resolutions?.[0]?.keepQty, 4);
    assert.equal(pauseSnapshot?.resolutions?.[0]?.lossQty, 2);

    const resumedWithDisposition = await db.$transaction(
      (tx) => resumePlan(tx, scope, disposalPlan.id),
      { timeout: 30_000 },
    );
    assert.equal(resumedWithDisposition.state, SamplePlanState.IN_PROGRESS);
    assert.equal(
      resumedWithDisposition.reservedQty,
      6,
      "resume must re-issue the current-step quantity returned or written off during pause",
    );
    assert.equal(
      Number((await db.batchBalance.findFirstOrThrow({
        where: { batchId: disposalBatch.id, locationId: warehouse.id },
      })).onHandQty),
      1,
    );
    assert.equal(
      Number((await db.batchBalance.findFirstOrThrow({
        where: { batchId: disposalBatch.id, locationId: production.id },
      })).onHandQty),
      10,
    );
    const completedDisposition = await db.$transaction(
      (tx) => completeStep(tx, scope, disposalPlan.id, {
        materials: [{ materialId: flowerPauseDispose.id, usedQty: 10 }],
        disassemble: false,
      }),
      { timeout: 30_000 },
    );
    assert.equal(completedDisposition.planCompleted, true);
    assert.equal(
      Number((await db.batchBalance.findFirstOrThrow({
        where: { batchId: disposalBatch.id, locationId: warehouse.id },
      })).onHandQty),
      1,
    );
    assert.equal(
      Number((await db.batchBalance.findFirstOrThrow({
        where: { batchId: disposalBatch.id, locationId: production.id },
      })).onHandQty),
      0,
    );

    // A customer order can release an approved plan's reservations. After the
    // missing stock is purchased, recalculate in place, re-approve and resume.
    const flower5 = await db.material.create({
      data: {
        tenantId,
        code: `S4-PLAN-PEONY-${marker}`,
        name: "打样牡丹",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        standardUsableRate: "0.5000",
        active: true,
      },
    });
    await makeBatch(db, {
      id: `s4-risk-a-${marker}`,
      storeId: store.id,
      locationId: warehouse.id,
      materialId: flower5.id,
      batchNo: `BATCH-RISK-A-${marker}`,
      quantity: 6,
      unitCost: 2,
    });
    await makeBatch(db, {
      id: `s4-risk-b-${marker}`,
      storeId: store.id,
      locationId: warehouse.id,
      materialId: flower5.id,
      batchNo: `BATCH-RISK-B-${marker}`,
      quantity: 4,
      unitCost: 2,
    });
    const sampleH = await makeSample(db, {
      code: `SMP-H-${marker}`,
      name: "样品 H",
      materialId: flower5.id,
      quantity: 10,
    });
    await db.sample.updateMany({
      where: { tenantId, id: { not: sampleH.id } },
      data: { state: SampleState.ARCHIVED },
    });

    const riskPlan = await db.$transaction((tx) => saveSamplePlan(tx, scope, {
      name: "风险计划原地重算测试",
      items: [{ sampleId: sampleH.id, quantity: 1, mandatory: true, sequenceNo: 1 }],
    }));
    await db.$transaction((tx) => calculatePlan(tx, scope, riskPlan.id), { timeout: 30_000 });
    const riskApproved = await db.$transaction(
      (tx) => approvePlan(tx, scope, riskPlan.id),
      { timeout: 30_000 },
    );
    assert.equal(riskApproved.reservedQty, 10);
    const riskExecution = await db.samplePlanExecution.findFirstOrThrow({
      where: { planId: riskPlan.id, cancelledAt: null },
      include: { steps: true },
    });

    const riskOrder = await db.order.create({
      data: {
        tenantId,
        storeId: store.id,
        number: `ORD-RISK-RECALC-${marker}`,
        createdVia: OrderEntry.STAFF_PORTAL,
        sourceChannel: "staff",
        commercialState: CommercialState.CONFIRMED,
      },
    });
    const riskItem = await db.orderItem.create({
      data: {
        orderId: riskOrder.id,
        kind: OrderItemKind.STANDARD,
        nameSnapshot: "顾客优先订单",
        quantity: 1,
        unitPrice: 100,
      },
    });
    const riskRevision = await db.orderRevision.create({
      data: { orderId: riskOrder.id, number: 1 },
    });
    const riskRequirement = await db.orderMaterialRequirement.create({
      data: {
        orderItemId: riskItem.id,
        revisionId: riskRevision.id,
        materialId: flower5.id,
        plannedQty: 4,
        needBy: future,
      },
    });
    const riskReservation = await db.$transaction(
      (tx) => reserveOrderMaterial(tx, riskRequirement.id),
      { timeout: 30_000 },
    );
    assert.equal(riskReservation.reserved, 4);
    const riskReservationRows = await db.sampleInventoryReservation.findMany({
      where: { executionId: riskExecution.id },
    });
    assert.equal(
      riskReservationRows.filter((row) => row.state === ReservationState.ACTIVE).length,
      1,
      "the order takes one batch reservation and leaves the other for recalculation",
    );
    assert.equal(
      riskReservationRows.filter((row) => row.state === ReservationState.RELEASED).length,
      1,
    );

    // Purchase the missing four stems after the conflict.
    await makeBatch(db, {
      id: `s4-risk-c-${marker}`,
      storeId: store.id,
      locationId: warehouse.id,
      materialId: flower5.id,
      batchNo: `BATCH-RISK-C-${marker}`,
      quantity: 4,
      unitCost: 2,
    });

    const recalculated = await db.$transaction(
      (tx) => recalculatePlan(tx, scope, riskPlan.id),
      { timeout: 30_000 },
    );
    assert.equal(recalculated.cancelledExecutionId, riskExecution.id);
    assert.equal(recalculated.releasedReservations, 1);
    assert.equal(recalculated.runs.length, 1);
    assert.equal(recalculated.runs[0]!.purchaseQty, 0);
    assert.equal(recalculated.runs[0]!.totalCost, 20);
    const afterRecalc = await db.samplePlan.findUniqueOrThrow({
      where: { id: riskPlan.id },
      include: { executions: true },
    });
    assert.equal(afterRecalc.state, SamplePlanState.PROPOSED);
    assert.equal(afterRecalc.approvedAt, null);
    assert.equal(afterRecalc.selectedRunId, recalculated.runs[0]!.id);
    const closedExecution = afterRecalc.executions.find((row) => row.id === riskExecution.id);
    assert.ok(closedExecution?.cancelledAt);
    const oldSteps = await db.samplePlanExecutionStep.findMany({
      where: { executionId: riskExecution.id },
    });
    assert.ok(oldSteps.length > 0);
    assert.ok(oldSteps.every((step) => step.recalculatedAt));
    const recalcAudit = await db.auditEvent.findFirst({
      where: {
        entityId: riskPlan.id,
        action: "SAMPLE_PLAN_RECALCULATED",
      },
    });
    assert.ok(recalcAudit);
    assert.equal(
      (recalcAudit.afterSnapshot as { previousExecutionId?: string } | null)?.previousExecutionId,
      riskExecution.id,
    );

    const reapproved = await db.$transaction(
      (tx) => approvePlan(tx, scope, riskPlan.id),
      { timeout: 30_000 },
    );
    assert.equal(reapproved.reservedQty, 10);
    assert.equal(reapproved.shortageQty, 0);
    const restarted = await db.$transaction(
      (tx) => startPlan(tx, scope, riskPlan.id),
      { timeout: 30_000 },
    );
    assert.equal(restarted.issuedQty, 10);
    await assert.rejects(
      db.$transaction((tx) => recalculatePlan(tx, scope, riskPlan.id), { timeout: 30_000 }),
      /已开始制作/,
    );

    // Ideal-reuse first batch: same material, zero stock, 15 then 20. Standard
    // and optimistic usable rates are null; the plan must still reuse 15 and
    // show a 5-stem qualified-material shortfall. Execution is still driven by
    // the actual disassembly confirmation.
    const idealFlower = await db.material.create({
      data: {
        tenantId,
        code: `S4-IDEAL-${marker}`,
        name: "理想复用高原红",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        standardUsableRate: null,
        optimisticUsableRate: null,
        active: true,
      },
    });
    const idealSampleA = await makeSample(db, {
      code: `SMP-IDEAL-003-${marker}`,
      name: "理想复用 003",
      materialId: idealFlower.id,
      quantity: 15,
    });
    const idealSampleB = await makeSample(db, {
      code: `SMP-IDEAL-059-${marker}`,
      name: "理想复用 059",
      materialId: idealFlower.id,
      quantity: 20,
    });
    const idealPlan = await db.$transaction((tx) => saveSamplePlan(tx, scope, {
      name: "理想复用 003→059",
      items: [
        { sampleId: idealSampleA.id, quantity: 1, mandatory: true, sequenceNo: 1 },
        { sampleId: idealSampleB.id, quantity: 1, mandatory: true, sequenceNo: 2 },
      ],
    }));
    const idealCalculated = await db.$transaction(
      (tx) => calculatePlan(tx, scope, idealPlan.id),
      { timeout: 30_000 },
    );
    // Batch 2 multi-master plans may also offer an optional companion sample.
    // Select the exact two-step base run for the execution assertions below.
    const idealBase = idealCalculated.runs.find((run) => run.stepCount === 2);
    assert.ok(idealBase);
    await db.$transaction((tx) => selectPlanRun(tx, scope, idealPlan.id, idealBase.id), {
      timeout: 30_000,
    });
    const idealRun = await db.samplePlanRun.findFirstOrThrow({
      where: { planId: idealPlan.id, id: idealBase.id },
      include: { steps: { include: { flows: true }, orderBy: { sequenceNo: "asc" } } },
    });
    assert.equal(idealRun.algorithmVersion, "sample-plan-v4-batch2");
    assert.equal(Number(idealRun.totalCost), 40);
    assert.equal(Number(idealRun.estimatedSaving), 30);
    assert.deepEqual(idealRun.lossPolicySnapshot, {
      defaultReusableRate: 1,
      byMaterialId: { [idealFlower.id]: 1 },
    });
    const idealFirst = idealRun.steps[0]!;
    const idealSecond = idealRun.steps[1]!;
    assert.equal(Number(idealFirst.flows[0]!.requiredQty), 15);
    assert.equal(Number(idealFirst.flows[0]!.stockQty), 0);
    assert.equal(Number(idealFirst.flows[0]!.purchaseQty), 15);
    assert.equal(Number(idealFirst.flows[0]!.reusableAfterDisassemblyQty), 15);
    assert.equal(Number(idealFirst.flows[0]!.lossQty), 0);
    assert.equal(Number(idealSecond.flows[0]!.reusedQty), 15);
    assert.equal(Number(idealSecond.flows[0]!.purchaseQty), 5);
    assert.equal(Number(idealSecond.flows[0]!.reusableAfterDisassemblyQty), 0);
    assert.equal(Number(idealSecond.flows[0]!.lossQty), 0);

    // Purchase only the first-step quantity, then report 12 actually reusable
    // stems. The second step must see an 8-stem shortfall instead of trusting
    // the earlier 15-stem forecast.
    await makeBatch(db, {
      storeId: store.id,
      locationId: warehouse.id,
      materialId: idealFlower.id,
      batchNo: `BATCH-IDEAL-${marker}`,
      quantity: 15,
      unitCost: 2,
    });
    await db.$transaction((tx) => approvePlan(tx, scope, idealPlan.id), { timeout: 30_000 });
    await db.$transaction((tx) => startPlan(tx, scope, idealPlan.id), { timeout: 30_000 });
    await db.$transaction((tx) => completeStep(tx, scope, idealPlan.id, {
      materials: [{ materialId: idealFlower.id, usedQty: 15, reusableQty: 12 }],
      disassemble: true,
      lossReason: "实际拆解仅 12 支可复用",
    }), { timeout: 30_000 });
    await assert.rejects(
      db.$transaction((tx) => startNextStep(tx, scope, idealPlan.id), { timeout: 30_000 }),
      /缺料 8/,
    );

    // Batch 2: confirmed sample material substitution. A shortage proposes a
    // three-level match; nothing changes until `confirmed` is true and the
    // replacement covers the whole requirement with enough availability.
    const fromMaterial = await db.material.create({
      data: {
        tenantId,
        code: `S4-SUB-FROM-${marker}`,
        name: "换料前高原红",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        flowerVariety: "玫瑰",
        flowerProductName: "高原红",
        color: "红",
        active: true,
      },
    });
    const toMaterial = await db.material.create({
      data: {
        tenantId,
        code: `S4-SUB-TO-${marker}`,
        name: "换料后高原红",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "3.0000",
        flowerVariety: "玫瑰",
        flowerProductName: "高原红",
        color: "红",
        active: true,
      },
    });
    const otherVariety = await db.material.create({
      data: {
        tenantId,
        code: `S4-SUB-TULIP-${marker}`,
        name: "换料郁金香",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "1.0000",
        flowerVariety: "郁金香",
        flowerProductName: "黄",
        color: "黄",
        active: true,
      },
    });
    await makeBatch(db, {
      storeId: store.id,
      locationId: warehouse.id,
      materialId: toMaterial.id,
      batchNo: `BATCH-SUB-${marker}`,
      quantity: 20,
      unitCost: 3,
    });
    const substitutionSample = await makeSample(db, {
      code: `SMP-SUB-${marker}`,
      name: "换料测试样品",
      materialId: fromMaterial.id,
      quantity: 5,
    });
    const proposals = await loadSampleSubstitutionProposals(db, scope, substitutionSample.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]!.fromMaterialId, fromMaterial.id);
    assert.equal(proposals[0]!.options[0]!.materialId, toMaterial.id);
    assert.equal(proposals[0]!.options[0]!.tier, "exact");
    assert.ok(!proposals[0]!.options.some((option) => option.materialId === otherVariety.id));

    await assert.rejects(
      db.$transaction((tx) => confirmSampleMaterialSubstitution(tx, scope, {
        sampleId: substitutionSample.id,
        fromMaterialId: fromMaterial.id,
        toMaterialId: toMaterial.id,
        quantity: 4,
        confirmed: true,
      })),
      /换料数量必须等于原需求/,
    );
    await assert.rejects(
      db.$transaction((tx) => confirmSampleMaterialSubstitution(tx, scope, {
        sampleId: substitutionSample.id,
        fromMaterialId: fromMaterial.id,
        toMaterialId: toMaterial.id,
        confirmed: false,
      })),
      /必须由员工明确确认/,
    );
    await assert.rejects(
      db.$transaction((tx) => confirmSampleMaterialSubstitution(tx, scope, {
        sampleId: substitutionSample.id,
        fromMaterialId: fromMaterial.id,
        toMaterialId: otherVariety.id,
        confirmed: true,
      })),
      /三级分类匹配/,
    );

    const confirmed = await db.$transaction((tx) => confirmSampleMaterialSubstitution(tx, scope, {
      sampleId: substitutionSample.id,
      fromMaterialId: fromMaterial.id,
      toMaterialId: toMaterial.id,
      quantity: 5,
      reason: "原物料缺货，同三级分类替代",
      confirmed: true,
    }));
    assert.equal(confirmed.tier, "exact");
    assert.equal(confirmed.quantity, 5);
    const replaced = await db.sampleMaterial.findFirstOrThrow({
      where: { sampleId: substitutionSample.id },
    });
    assert.equal(replaced.materialId, toMaterial.id);
    const substitutionRecord = await db.sampleMaterialSubstitution.findFirstOrThrow({
      where: { sampleId: substitutionSample.id },
    });
    assert.equal(substitutionRecord.fromMaterialId, fromMaterial.id);
    assert.equal(substitutionRecord.toMaterialId, toMaterial.id);
    assert.equal(substitutionRecord.confirmedById, scope.actorStaffId);
    const substitutionAudit = await db.auditEvent.findFirst({
      where: {
        tenantId,
        entityType: "Sample",
        entityId: substitutionSample.id,
        action: "SAMPLE_MATERIAL_SUBSTITUTED",
      },
    });
    assert.ok(substitutionAudit);

    // A shortage larger than the candidate's availability is rejected and the
    // original recipe stays unchanged.
    const tooLargeSample = await makeSample(db, {
      code: `SMP-SUB-BIG-${marker}`,
      name: "换料缺口样品",
      materialId: fromMaterial.id,
      quantity: 50,
    });
    await assert.rejects(
      db.$transaction((tx) => confirmSampleMaterialSubstitution(tx, scope, {
        sampleId: tooLargeSample.id,
        fromMaterialId: fromMaterial.id,
        toMaterialId: toMaterial.id,
        quantity: 50,
        confirmed: true,
      })),
      /可用量不足/,
    );
    const unchanged = await db.sampleMaterial.findFirstOrThrow({
      where: { sampleId: tooLargeSample.id },
    });
    assert.equal(unchanged.materialId, fromMaterial.id);

    // Batch 2: photo/retention constraints are persisted on plan items and
    // drive the auto schedule order and step snapshots.
    const scheduleFlower = await db.material.create({
      data: {
        tenantId,
        code: `S4-SCHEDULE-${marker}`,
        name: "排程测试花材",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "1.0000",
        active: true,
      },
    });
    const schedulePhoto = await makeSample(db, {
      code: `SMP-SCHEDULE-PHOTO-${marker}`,
      name: "先拍摄样品",
      materialId: scheduleFlower.id,
      quantity: 2,
    });
    const scheduleRetain = await makeSample(db, {
      code: `SMP-SCHEDULE-RETAIN-${marker}`,
      name: "留样样品",
      materialId: scheduleFlower.id,
      quantity: 3,
    });
    const schedulePlan = await db.$transaction((tx) => saveSamplePlan(tx, scope, {
      name: "拍摄与留样排程",
      items: [
        {
          sampleId: schedulePhoto.id,
          quantity: 1,
          mandatory: true,
          sequenceNo: 1,
          photoDueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
        {
          sampleId: scheduleRetain.id,
          quantity: 1,
          mandatory: true,
          sequenceNo: 2,
          retentionUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      ],
    }));
    const scheduleCalculated = await db.$transaction(
      (tx) => calculatePlan(tx, scope, schedulePlan.id),
      { timeout: 30_000 },
    );
    const scheduleBase = scheduleCalculated.runs.find((run) => run.stepCount === 2);
    assert.ok(scheduleBase);
    await db.$transaction((tx) => selectPlanRun(tx, scope, schedulePlan.id, scheduleBase.id), {
      timeout: 30_000,
    });
    const scheduleRun = await db.samplePlanRun.findFirstOrThrow({
      where: { planId: schedulePlan.id, id: scheduleBase.id },
      include: { steps: { orderBy: { sequenceNo: "asc" } } },
    });
    assert.equal(scheduleRun.steps[0]!.sampleId, schedulePhoto.id);
    assert.ok(scheduleRun.steps[0]!.photoDueAt);
    assert.ok(scheduleRun.steps[0]!.plannedStartAt);
    assert.ok(scheduleRun.steps[0]!.plannedEndAt);
    assert.equal(scheduleRun.steps[1]!.sampleId, scheduleRetain.id);
    assert.equal(scheduleRun.steps[1]!.retained, true);
    assert.ok(scheduleRun.steps[1]!.retentionUntil);

    // Single-main creation drawer: recommendations are ranked by the trial
    // reuse rate, and create+calculate persists exactly the selected samples
    // (maxSuggestions: 1 prevents an extra automatic companion step).
    const recommendationFlower = await db.material.create({
      data: {
        tenantId,
        code: `S4-RECOMMEND-ROSE-${marker}`,
        name: "打样推荐玫瑰",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        active: true,
      },
    });
    const recommendationExtra = await db.material.create({
      data: {
        tenantId,
        code: `S4-RECOMMEND-EXTRA-${marker}`,
        name: "打样推荐配材",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "1.0000",
        active: true,
      },
    });
    const recommendationMain = await makeSample(db, {
      code: `SMP-REC-MAIN-${marker}`,
      name: "推荐主样品",
      materialId: recommendationFlower.id,
      quantity: 10,
    });
    const recommendationFull = await makeSample(db, {
      code: `SMP-REC-FULL-${marker}`,
      name: "推荐全复用样品",
      materialId: recommendationFlower.id,
      quantity: 6,
    });
    const recommendationShort = await makeSample(db, {
      code: `SMP-REC-SHORT-${marker}`,
      name: "推荐复用不足样品",
      materialId: recommendationFlower.id,
      quantity: 20,
    });
    const recommendationMixed = await db.sample.create({
      data: {
        tenantId,
        code: `SMP-REC-MIXED-${marker}`,
        name: "推荐换料样品",
        state: SampleState.READY,
        materials: {
          create: [
            { materialId: recommendationFlower.id, quantity: 10 },
            { materialId: recommendationExtra.id, quantity: 2 },
          ],
        },
      },
    });

    const recommendations = await db.$transaction((tx) =>
      loadSamplePlanRecommendations(tx, scope, {
        mainSampleId: recommendationMain.id,
        plannedCount: 4,
      })
    );
    assert.equal(recommendations.requestedCount, 3);
    assert.ok(recommendations.eligibleCount >= 3);
    assert.deepEqual(
      recommendations.candidates.map((row) => row.sampleId),
      [recommendationFull.id, recommendationMixed.id, recommendationShort.id],
    );
    assert.equal(recommendations.candidates[0]!.reuseRate, 1);
    assert.equal(recommendations.candidates[0]!.requiresSubstitution, false);
    assert.equal(recommendations.candidates[1]!.reuseRate, 0.8333);
    assert.equal(recommendations.candidates[1]!.requiresSubstitution, true);
    assert.equal(recommendations.candidates[2]!.reuseRate, 0.5);

    // Expandable per-material detail comes from the same trial and keeps the
    // candidate's requirement, the reused share and the uncovered remainder.
    assert.deepEqual(recommendations.candidates[0]!.materials, [
      {
        materialId: recommendationFlower.id,
        name: "打样推荐玫瑰",
        baseUnit: "支",
        requiredQty: 6,
        reusedQty: 6,
        remainingQty: 0,
      },
    ]);
    assert.deepEqual(
      recommendations.candidates[1]!.materials.map((material) => ({
        materialId: material.materialId,
        requiredQty: material.requiredQty,
        reusedQty: material.reusedQty,
        remainingQty: material.remainingQty,
      })),
      [
        { materialId: recommendationFlower.id, requiredQty: 10, reusedQty: 10, remainingQty: 0 },
        { materialId: recommendationExtra.id, requiredQty: 2, reusedQty: 0, remainingQty: 2 },
      ],
    );

    const createdFromRecommendation = await db.$transaction((tx) =>
      createPlanFromRecommendation(tx, scope, {
        name: "推荐主样品打样计划",
        mainSampleId: recommendationMain.id,
        plannedCount: 4,
        selectedSampleIds: [recommendationFull.id, recommendationMixed.id],
      }), { timeout: 30_000 });
    assert.equal(createdFromRecommendation.plan.name, "推荐主样品打样计划");
    assert.equal(createdFromRecommendation.calculation.runs.length, 1);
    assert.equal(createdFromRecommendation.calculation.runs[0]!.stepCount, 3);
    const storedRecommendationPlan = await db.samplePlan.findUniqueOrThrow({
      where: { id: createdFromRecommendation.plan.id },
      include: { items: { orderBy: { sequenceNo: "asc" } } },
    });
    assert.equal(storedRecommendationPlan.state, SamplePlanState.PROPOSED);
    assert.deepEqual(
      storedRecommendationPlan.items.map((item) => item.sampleId),
      [recommendationMain.id, recommendationFull.id, recommendationMixed.id],
    );
    assert.deepEqual(
      storedRecommendationPlan.items.map((item) => item.mandatory),
      [true, false, false],
    );

    // The drawer may supply a user-entered plan name; it replaces the fallback
    // generated from the main sample.
    const customNamedPlan = await db.$transaction((tx) =>
      createPlanFromRecommendation(tx, scope, {
        name: "自定义推荐打样计划",
        mainSampleId: recommendationMain.id,
        plannedCount: 2,
        selectedSampleIds: [recommendationFull.id],
      }), { timeout: 30_000 });
    assert.equal(customNamedPlan.plan.name, "自定义推荐打样计划");

    console.log("v2 sample planning DB tests passed");
  } finally {
    try {
      await cleanup(db);
    } catch (error) {
      console.error("sample planning cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
