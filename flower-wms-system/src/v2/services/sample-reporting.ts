import { Prisma, SamplePlanState, SampleState } from "../../generated/prisma-v2/client";
import {
  calculateSamplePricing,
  conversionRate,
  costVariance,
  reuseRate,
  type CostVarianceResult,
} from "../domain/sample-pricing";

export type SampleReportScope = { tenantId: string; storeId: string };

export type SampleReportSampleRow = {
  id: string;
  code: string;
  name: string;
  state: SampleState;
  materialCount: number;
  standardCost: number;
  targetMarginRate: number | null;
  suggestedPrice: number | null;
  skuCount: number;
  activeSkuCount: number;
  planCount: number;
};

export type SampleReportPlanRow = {
  id: string;
  name: string;
  state: SamplePlanState;
  sampleCount: number;
  convertedSkuCount: number;
  plannedCost: number;
  actualCost: number | null;
  variance: CostVarianceResult;
  plannedReuseRate: number;
  actualReuseRate: number | null;
  estimatedSaving: number;
  hasExecution: boolean;
};

export type SampleReportSummary = {
  sampleCount: number;
  readySampleCount: number;
  convertedSampleCount: number;
  conversionRate: number;
  sampleSkuCount: number;
  planCount: number;
  completedPlanCount: number;
  plannedCost: number;
  actualCost: number;
  costVariance: CostVarianceResult;
  plannedReuseRate: number;
  actualReuseRate: number | null;
};

export type SampleReportData = {
  summary: SampleReportSummary;
  samples: SampleReportSampleRow[];
  plans: SampleReportPlanRow[];
  generatedAt: Date;
};

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function reusedByMaterial(value: Prisma.JsonValue | null): Record<string, number> {
  const raw = jsonObject(value).reusedByMaterial;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [materialId, quantity] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0) {
      result[materialId] = quantity;
    }
  }
  return result;
}

function roundMoney(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100;
}

export async function getSampleReport(
  db: Prisma.TransactionClient,
  scope: SampleReportScope,
): Promise<SampleReportData> {
  if (!scope?.tenantId || !scope.storeId) throw new Error("缺少租户或门店信息");
  const [samples, plans] = await Promise.all([
    db.sample.findMany({
      where: { tenantId: scope.tenantId },
      include: {
        materials: {
          include: { material: { select: { standardUnitCost: true } } },
        },
        sourceSkus: { select: { id: true, active: true } },
        planItems: { select: { planId: true } },
      },
      orderBy: [{ state: "asc" }, { code: "asc" }],
    }),
    db.samplePlan.findMany({
      where: { tenantId: scope.tenantId, storeId: scope.storeId },
      include: {
        items: {
          include: {
            sample: {
              select: {
                id: true,
                code: true,
                name: true,
                sourceSkus: { select: { id: true } },
              },
            },
          },
        },
        runs: {
          include: {
            steps: { include: { flows: true } },
            inventory: { select: { materialId: true, unitCost: true } },
          },
          orderBy: { runNo: "desc" },
        },
        executions: {
          include: {
            selectedRun: {
              include: {
                inventory: { select: { materialId: true, unitCost: true } },
                steps: { include: { flows: true } },
              },
            },
            steps: {
              include: {
                plannedStep: { include: { flows: true } },
                reservations: { include: { batch: { select: { materialId: true } } } },
              },
            },
          },
          orderBy: { approvedAt: "desc" },
        },
      },
      orderBy: [{ name: "asc" }],
    }),
  ]);

  const sampleRows: SampleReportSampleRow[] = samples.map((sample) => {
    const standardCost = roundMoney(sample.materials.reduce(
      (sum, line) => sum + Number(line.quantity) * (line.material.standardUnitCost === null
        ? 0
        : Number(line.material.standardUnitCost)),
      0,
    ));
    const margin = sample.targetMarginRate === null ? null : Number(sample.targetMarginRate);
    const pricing = calculateSamplePricing({
      materialCost: standardCost,
      targetMarginRate: margin,
    });
    return {
      id: sample.id,
      code: sample.code,
      name: sample.name,
      state: sample.state,
      materialCount: sample.materials.length,
      standardCost,
      targetMarginRate: margin,
      suggestedPrice: pricing.suggestedPrice,
      skuCount: sample.sourceSkus.length,
      activeSkuCount: sample.sourceSkus.filter((sku) => sku.active).length,
      planCount: new Set(sample.planItems.map((item) => item.planId)).size,
    };
  });

  const planRows: SampleReportPlanRow[] = plans.map((plan) => {
    const selectedRun = plan.runs.find((run) => run.id === plan.selectedRunId) ?? plan.runs[0] ?? null;
    const latestExecution = plan.executions[0] ?? null;
    const plannedCost = selectedRun ? Number(selectedRun.totalCost) : 0;
    const actualCost = latestExecution?.actualCost === null || latestExecution?.actualCost === undefined
      ? null
      : Number(latestExecution.actualCost);

    const plannedCostByMaterial = new Map(
      (selectedRun?.inventory ?? []).map((row) => [row.materialId, Number(row.unitCost)]),
    );
    let plannedInputCost = 0;
    let plannedReusedCost = 0;
    for (const step of selectedRun?.steps ?? []) {
      for (const flow of step.flows) {
        const unitCost = plannedCostByMaterial.get(flow.materialId) ?? 0;
        plannedInputCost += Number(flow.requiredQty) * unitCost;
        plannedReusedCost += Number(flow.reusedQty) * unitCost;
      }
    }

    let actualInputCost = 0;
    let actualReusedCost = 0;
    if (latestExecution) {
      const actualCostByMaterial = new Map(
        (latestExecution.selectedRun?.inventory ?? []).map((row) => [row.materialId, Number(row.unitCost)]),
      );
      for (const step of latestExecution.steps) {
        const reused = reusedByMaterial(step.actualReusableSnapshot);
        const issued = new Map<string, number>();
        for (const reservation of step.reservations) {
          if (reservation.state !== "ISSUED" && reservation.state !== "CONSUMED") continue;
          const materialId = reservation.batch.materialId;
          issued.set(materialId, (issued.get(materialId) ?? 0) + Number(reservation.quantity));
        }
        for (const flow of step.plannedStep.flows) {
          const unitCost = actualCostByMaterial.get(flow.materialId) ?? 0;
          actualInputCost += ((issued.get(flow.materialId) ?? 0) + (reused[flow.materialId] ?? 0)) * unitCost;
          actualReusedCost += (reused[flow.materialId] ?? 0) * unitCost;
        }
      }
    }

    const convertedSkuIds = new Set(
      plan.items.flatMap((item) => item.sample.sourceSkus.map((sku) => sku.id)),
    );
    return {
      id: plan.id,
      name: plan.name,
      state: plan.state,
      sampleCount: plan.items.length,
      convertedSkuCount: convertedSkuIds.size,
      plannedCost,
      actualCost,
      variance: costVariance(plannedCost, actualCost ?? plannedCost),
      plannedReuseRate: reuseRate(plannedReusedCost, plannedInputCost),
      actualReuseRate: latestExecution ? reuseRate(actualReusedCost, actualInputCost) : null,
      estimatedSaving: selectedRun ? Number(selectedRun.estimatedSaving) : 0,
      hasExecution: Boolean(latestExecution),
    };
  });

  const eligibleSamples = sampleRows.filter((sample) => sample.state !== SampleState.DRAFT);
  const convertedSampleCount = eligibleSamples.filter((sample) => sample.skuCount > 0).length;
  const readySampleCount = eligibleSamples.length;
  const completedPlans = planRows.filter((plan) => plan.state === SamplePlanState.COMPLETED);
  const plannedCost = roundMoney(planRows.reduce((sum, plan) => sum + plan.plannedCost, 0));
  const actualCost = roundMoney(planRows.reduce(
    (sum, plan) => sum + (plan.hasExecution ? (plan.actualCost ?? 0) : plan.plannedCost),
    0,
  ));
  const plannedInputTotal = plans.reduce((sum, plan) => {
    const selectedRun = plan.runs.find((run) => run.id === plan.selectedRunId) ?? plan.runs[0];
    if (!selectedRun) return sum;
    const costs = new Map(selectedRun.inventory.map((row) => [row.materialId, Number(row.unitCost)]));
    return sum + selectedRun.steps.reduce((stepSum, step) => stepSum + step.flows.reduce((flowSum, flow) => {
      const unitCost = costs.get(flow.materialId) ?? 0;
      return flowSum + Number(flow.requiredQty) * unitCost;
    }, 0), 0);
  }, 0);
  const plannedReusedTotal = plans.reduce((sum, plan) => {
    const selectedRun = plan.runs.find((run) => run.id === plan.selectedRunId) ?? plan.runs[0];
    if (!selectedRun) return sum;
    const costs = new Map(selectedRun.inventory.map((row) => [row.materialId, Number(row.unitCost)]));
    return sum + selectedRun.steps.reduce((stepSum, step) => stepSum + step.flows.reduce((flowSum, flow) => {
      const unitCost = costs.get(flow.materialId) ?? 0;
      return flowSum + Number(flow.reusedQty) * unitCost;
    }, 0), 0);
  }, 0);
  // Actual cost-weighted reuse is aggregated per plan from its latest execution.
  let actualInputCostTotal = 0;
  let actualReusedCostTotal = 0;
  for (const plan of plans) {
    const latestExecution = plan.executions[0];
    if (!latestExecution) continue;
    const costs = new Map(
      (latestExecution.selectedRun?.inventory ?? []).map((row) => [row.materialId, Number(row.unitCost)]),
    );
    for (const step of latestExecution.steps) {
      const reused = reusedByMaterial(step.actualReusableSnapshot);
      const issued = new Map<string, number>();
      for (const reservation of step.reservations) {
        if (reservation.state !== "ISSUED" && reservation.state !== "CONSUMED") continue;
        issued.set(
          reservation.batch.materialId,
          (issued.get(reservation.batch.materialId) ?? 0) + Number(reservation.quantity),
        );
      }
      for (const flow of step.plannedStep.flows) {
        const unitCost = costs.get(flow.materialId) ?? 0;
        actualInputCostTotal += ((issued.get(flow.materialId) ?? 0) + (reused[flow.materialId] ?? 0)) * unitCost;
        actualReusedCostTotal += (reused[flow.materialId] ?? 0) * unitCost;
      }
    }
  }

  return {
    summary: {
      sampleCount: sampleRows.length,
      readySampleCount,
      convertedSampleCount,
      conversionRate: conversionRate(convertedSampleCount, readySampleCount),
      sampleSkuCount: sampleRows.reduce((sum, sample) => sum + sample.skuCount, 0),
      planCount: planRows.length,
      completedPlanCount: completedPlans.length,
      plannedCost,
      actualCost,
      costVariance: costVariance(plannedCost, actualCost),
      plannedReuseRate: reuseRate(plannedReusedTotal, plannedInputTotal),
      actualReuseRate: actualInputCostTotal > 0
        ? reuseRate(actualReusedCostTotal, actualInputCostTotal)
        : null,
    },
    samples: sampleRows,
    plans: planRows,
    generatedAt: new Date(),
  };
}
