import {
  Prisma,
  PrismaClient,
  SamplePlanState,
  SampleState,
} from "../../generated/prisma-v2/client";
import {
  proposeSampleSubstitutions,
  sampleSubstitutionTier,
  type SampleSubstitutionProposal,
  type SampleSubstitutionTier,
} from "../domain/sample-substitution";
import { getMaterialAvailableQuantities } from "./material-availability";

export type SampleSubstitutionScope = {
  tenantId: string;
  storeId: string;
  actorStaffId: string;
};

export type ConfirmSampleSubstitutionInput = {
  sampleId: string;
  fromMaterialId: string;
  toMaterialId: string;
  quantity?: number;
  reason?: string | null;
  /** Must be true; substitution is never automatic. */
  confirmed: boolean;
};

export type ConfirmSampleSubstitutionResult = {
  sampleId: string;
  substitutionId: string;
  fromMaterialId: string;
  toMaterialId: string;
  quantity: number;
  tier: SampleSubstitutionTier;
  requiresRecalculation: boolean;
};

function assertScope(scope: SampleSubstitutionScope): void {
  if (!scope?.tenantId?.trim() || !scope.storeId?.trim() || !scope.actorStaffId?.trim()) {
    throw new Error("缺少租户、门店或操作员工信息");
  }
}

function materialSelection() {
  return {
    id: true,
    code: true,
    name: true,
    kind: true,
    baseUnit: true,
    flowerVariety: true,
    flowerProductName: true,
    color: true,
    standardUnitCost: true,
    active: true,
  } as const;
}

/**
 * Read-only substitution proposals for the sample page. Availability includes
 * active order and sample reservations, so a candidate is only suggested when
 * it can cover the shortage now.
 */
export async function loadSampleSubstitutionProposals(
  tx: Prisma.TransactionClient | PrismaClient,
  scope: SampleSubstitutionScope,
  sampleId: string,
): Promise<SampleSubstitutionProposal[]> {
  assertScope(scope);
  const id = typeof sampleId === "string" ? sampleId.trim() : "";
  if (!id) throw new Error("样品标识不能为空");
  const sample = await tx.sample.findFirst({
    where: { id, tenantId: scope.tenantId },
    include: {
      materials: { include: { material: { select: materialSelection() } } },
    },
  });
  if (!sample) throw new Error("样品不存在或不属于当前租户");

  const requiredIds = sample.materials.map((line) => line.materialId);
  const kinds = [...new Set(sample.materials.map((line) => line.material.kind))];
  const candidates = await tx.material.findMany({
    where: {
      tenantId: scope.tenantId,
      active: true,
      kind: { in: kinds },
      id: { notIn: requiredIds },
    },
    select: materialSelection(),
    orderBy: { code: "asc" },
    take: 500,
  });
  const materialIds = [...new Set([...requiredIds, ...candidates.map((row) => row.id)])];
  const availability = await getMaterialAvailableQuantities(tx, {
    tenantId: scope.tenantId,
    storeId: scope.storeId,
    materialIds,
  });

  return proposeSampleSubstitutions({
    requirements: sample.materials.map((line) => ({
      materialId: line.materialId,
      name: line.material.name,
      quantity: Number(line.quantity),
      availableQty: availability.get(line.materialId)?.availableQty ?? 0,
      kind: line.material.kind,
      baseUnit: line.material.baseUnit,
      flowerVariety: line.material.flowerVariety,
      flowerProductName: line.material.flowerProductName,
      color: line.material.color,
    })),
    candidates: candidates.map((material) => ({
      materialId: material.id,
      code: material.code,
      name: material.name,
      kind: material.kind,
      baseUnit: material.baseUnit,
      flowerVariety: material.flowerVariety,
      flowerProductName: material.flowerProductName,
      color: material.color,
      availableQty: availability.get(material.id)?.availableQty ?? 0,
      unitCost: Number(material.standardUnitCost ?? 0),
      active: material.active,
    })),
  });
}

/**
 * Employee-confirmed replacement of one sample material. The replacement must
 * cover the whole existing requirement (same rule as order substitution) and
 * the candidate must be a three-level classification match with enough
 * available stock. The original demand is captured in an immutable
 * `SampleMaterialSubstitution` row and an audit event before the recipe row is
 * repointed.
 */
export async function confirmSampleMaterialSubstitution(
  tx: Prisma.TransactionClient,
  scope: SampleSubstitutionScope,
  input: ConfirmSampleSubstitutionInput,
): Promise<ConfirmSampleSubstitutionResult> {
  assertScope(scope);
  if (!input.confirmed) throw new Error("换料必须由员工明确确认");
  const sampleId = typeof input.sampleId === "string" ? input.sampleId.trim() : "";
  const fromMaterialId = typeof input.fromMaterialId === "string" ? input.fromMaterialId.trim() : "";
  const toMaterialId = typeof input.toMaterialId === "string" ? input.toMaterialId.trim() : "";
  if (!sampleId || !fromMaterialId || !toMaterialId) throw new Error("样品或换料物料不能为空");
  if (fromMaterialId === toMaterialId) throw new Error("换料物料不能与原物料相同");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > 500) throw new Error("换料原因不能超过 500 个字符");

  await tx.$queryRaw`SELECT id FROM "Sample" WHERE id = ${sampleId} FOR UPDATE`;
  const sample = await tx.sample.findFirst({
    where: { id: sampleId, tenantId: scope.tenantId },
    include: {
      materials: { include: { material: { select: materialSelection() } } },
    },
  });
  if (!sample) throw new Error("样品不存在或不属于当前租户");
  if (sample.state === SampleState.ARCHIVED) throw new Error("已归档样品不能换料");

  const line = sample.materials.find((row) => row.materialId === fromMaterialId);
  if (!line) throw new Error("原物料不在当前样品配方中");
  const requiredQty = Number(line.quantity);
  if (input.quantity !== undefined) {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new Error("换料数量必须为正数");
    }
    if (Math.abs(input.quantity - requiredQty) > 1e-8) {
      throw new Error(`换料数量必须等于原需求 ${requiredQty}${line.material.baseUnit}`);
    }
  }

  const target = await tx.material.findFirst({
    where: { id: toMaterialId, tenantId: scope.tenantId },
    select: materialSelection(),
  });
  if (!target) throw new Error("替代物料不存在或不属于当前租户");
  if (!target.active) throw new Error("替代物料已停用");
  if (target.kind !== line.material.kind) throw new Error("替代物料必须与原物料类型相同");
  if (target.baseUnit !== line.material.baseUnit) throw new Error("替代物料必须使用相同基础单位");
  if (sample.materials.some((row) => row.materialId === target.id)) {
    throw new Error("替代物料已经在当前样品配方中");
  }

  const tier = sampleSubstitutionTier(line.material, target);
  if (!tier) throw new Error("替代物料与原物料没有可接受的三级分类匹配");

  const availability = await getMaterialAvailableQuantities(tx, {
    tenantId: scope.tenantId,
    storeId: scope.storeId,
    materialIds: [target.id],
  });
  const availableQty = availability.get(target.id)?.availableQty ?? 0;
  if (availableQty + 1e-8 < requiredQty) {
    throw new Error(`替代物料可用量不足：需要 ${requiredQty}，当前可用 ${availableQty}`);
  }

  const planItems = await tx.samplePlanItem.findMany({
    where: { sampleId },
    select: { planId: true },
  });
  const planIds = [...new Set(planItems.map((item) => item.planId))];
  if (planIds.length > 0) {
    const activeExecution = await tx.samplePlanExecution.findFirst({
      where: { planId: { in: planIds }, cancelledAt: null },
      select: { id: true },
    });
    if (activeExecution) throw new Error("样品已有进行中的打样计划，不能换料；请先取消或完成计划");
  }

  const substitution = await tx.sampleMaterialSubstitution.create({
    data: {
      sampleId,
      fromMaterialId,
      toMaterialId: target.id,
      quantity: requiredQty,
      tier,
      reason: reason || null,
      confirmedById: scope.actorStaffId,
    },
  });
  await tx.sampleMaterial.update({
    where: { id: line.id },
    data: { materialId: target.id },
  });
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action: "SAMPLE_MATERIAL_SUBSTITUTED",
      entityType: "Sample",
      entityId: sampleId,
      beforeSnapshot: {
        materialId: fromMaterialId,
        materialName: line.material.name,
        quantity: requiredQty,
      },
      afterSnapshot: {
        materialId: target.id,
        materialName: target.name,
        quantity: requiredQty,
        tier,
        substitutionId: substitution.id,
        reason: reason || null,
        confirmedById: scope.actorStaffId,
      },
    },
  });

  const pendingPlan = planIds.length === 0
    ? null
    : await tx.samplePlan.findFirst({
        where: {
          id: { in: planIds },
          state: {
            in: [
              SamplePlanState.DRAFT,
              SamplePlanState.PROPOSED,
              SamplePlanState.APPROVED,
              SamplePlanState.PAUSED,
            ],
          },
        },
        select: { id: true },
      });

  return {
    sampleId,
    substitutionId: substitution.id,
    fromMaterialId,
    toMaterialId: target.id,
    quantity: requiredQty,
    tier,
    requiresRecalculation: pendingPlan !== null,
  };
}
