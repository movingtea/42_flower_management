import { Prisma } from "../../generated/prisma-v2/client";
import {
  generateEntropy,
  generatePackagingKitCode,
} from "../domain/identifiers";
import { assertMaterialQuantity } from "../domain/stock-planning";
import { normalizeMasterCode } from "./master-data";

export type PackagingKitScope = {
  tenantId: string;
  storeId: string;
  actorStaffId: string;
};

export type PackagingKitLineInput = {
  materialId: string;
  quantity: number;
};

export type SavePackagingKitInput = {
  id?: string;
  /**
   * Optional on create: an empty value means the system-generated kit code.
   * On update the submitted code is only validated against the stored code;
   * the code itself is immutable after creation.
   */
  code?: string;
  name: string;
  notes?: string | null;
  lines: PackagingKitLineInput[];
};

const PACKAGING_MATERIAL_KINDS = ["PACKAGING", "CONSUMABLE", "OTHER"] as const;

function assertScope(scope: PackagingKitScope): void {
  if (!scope?.tenantId?.trim() || !scope.storeId?.trim() || !scope.actorStaffId?.trim()) {
    throw new Error("缺少租户、门店或操作员工信息");
  }
}

function normalizeNotes(value: string | null | undefined): string | null {
  const notes = value?.trim() ?? "";
  if (notes.length > 500) throw new Error("包装方案备注不能超过 500 个字符");
  return notes || null;
}

/**
 * Packaging kits are an independent, reusable packaging-material bundle.
 * They are never written into Recipe/RecipeVersion rows.
 */
export async function savePackagingKit(
  tx: Prisma.TransactionClient,
  scope: PackagingKitScope,
  input: SavePackagingKitInput,
) {
  assertScope(scope);

  const submittedCode =
    typeof input.code === "string" ? input.code.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("包装方案名称必填");
  if (name.length > 80) throw new Error("包装方案名称不能超过 80 个字符");
  const notes = normalizeNotes(input.notes);

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("包装方案至少需要一项物料");
  }

  const materialIds = input.lines.map((line) => {
    const materialId = typeof line?.materialId === "string" ? line.materialId.trim() : "";
    if (!materialId) throw new Error("包装物料不能为空");
    return materialId;
  });
  if (new Set(materialIds).size !== materialIds.length) {
    throw new Error("同一包装物料不能重复");
  }

  const materials = await tx.material.findMany({
    where: {
      id: { in: materialIds },
      tenantId: scope.tenantId,
      active: true,
      kind: { in: [...PACKAGING_MATERIAL_KINDS] },
    },
    select: { id: true, name: true, quantityScale: true },
  });
  if (materials.length !== materialIds.length) {
    throw new Error("方案包含不存在、停用或非包装类物料");
  }

  const lines = input.lines.map((line, index) => {
    const materialId = materialIds[index]!;
    const material = materials.find((item) => item.id === materialId)!;
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

  if (input.id) {
    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!id) throw new Error("包装方案不能为空");

    await tx.$queryRaw`SELECT id FROM "PackagingKit" WHERE id = ${id} FOR UPDATE`;
    const current = await tx.packagingKit.findFirst({
      where: { id, tenantId: scope.tenantId },
      include: { _count: { select: { lines: true } } },
    });
    if (!current) throw new Error("包装方案不存在");
    // The UI never submits a code on edit; a submitted code is only checked so
    // the "code is immutable after creation" rule also holds for API callers.
    if (submittedCode && current.code !== normalizeMasterCode(submittedCode)) {
      throw new Error("包装方案编码创建后不能修改");
    }

    await tx.packagingKitLine.deleteMany({ where: { packagingKitId: current.id } });
    const kit = await tx.packagingKit.update({
      where: { id: current.id },
      data: {
        name,
        notes,
        lines: { create: lines },
      },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        actorStaffId: scope.actorStaffId,
        action: "PACKAGING_KIT_UPDATED",
        entityType: "PackagingKit",
        entityId: kit.id,
        beforeSnapshot: {
          code: current.code,
          name: current.name,
          notes: current.notes,
          active: current.active,
          lineCount: current._count.lines,
        },
        afterSnapshot: {
          code: kit.code,
          name: kit.name,
          notes: kit.notes,
          active: kit.active,
          lineCount: lines.length,
        },
      },
    });
    return kit;
  }

  // New kits get a system identifier unless the caller supplies one explicitly
  // (imports, integrations and tests keep that escape hatch).
  const code = submittedCode
    ? normalizeMasterCode(submittedCode)
    : generatePackagingKitCode(new Date(), generateEntropy());

  const duplicate = await tx.packagingKit.findFirst({
    where: { tenantId: scope.tenantId, code },
    select: { id: true },
  });
  if (duplicate) throw new Error("包装方案编码已存在");

  let kit;
  try {
    kit = await tx.packagingKit.create({
      data: {
        tenantId: scope.tenantId,
        code,
        name,
        notes,
        lines: { create: lines },
      },
    });
  } catch (error) {
    // The unique constraint is the final guard for concurrent creates.
    if ((error as { code?: unknown }).code === "P2002") {
      throw new Error("包装方案编码已存在");
    }
    throw error;
  }
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action: "PACKAGING_KIT_CREATED",
      entityType: "PackagingKit",
      entityId: kit.id,
      afterSnapshot: {
        code: kit.code,
        name: kit.name,
        notes: kit.notes,
        active: kit.active,
        lineCount: lines.length,
      },
    },
  });
  return kit;
}

export async function setPackagingKitActive(
  tx: Prisma.TransactionClient,
  scope: PackagingKitScope,
  id: string,
  active: boolean,
) {
  assertScope(scope);
  const kitId = typeof id === "string" ? id.trim() : "";
  if (!kitId) throw new Error("包装方案不能为空");

  await tx.$queryRaw`SELECT id FROM "PackagingKit" WHERE id = ${kitId} FOR UPDATE`;
  const current = await tx.packagingKit.findFirst({
    where: { id: kitId, tenantId: scope.tenantId },
    select: { id: true, active: true },
  });
  if (!current) throw new Error("包装方案不存在");

  const kit = await tx.packagingKit.update({
    where: { id: current.id },
    data: { active },
  });
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action: active ? "PACKAGING_KIT_ACTIVATED" : "PACKAGING_KIT_DEACTIVATED",
      entityType: "PackagingKit",
      entityId: kit.id,
      beforeSnapshot: { active: current.active },
      afterSnapshot: { active },
    },
  });
  return kit;
}
