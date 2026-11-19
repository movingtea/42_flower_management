import type { Prisma } from "../../generated/prisma-v2/client";

/**
 * Material category master data.
 *
 * V1 never exposed a category code to staff, so the service owns a stable
 * internal code and the UI only edits the business fields. Every mutation is
 * audited so category changes remain traceable next to the material history.
 */
export type MaterialCategoryScope = {
  tenantId: string;
  storeId: string;
  actorStaffId: string;
};

export type MaterialCategoryInput = {
  name: string;
  description?: string | null;
  sortOrder?: number | string | null;
  active?: boolean;
};

export type MaterialCategoryResult = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
};

function assertScope(scope: MaterialCategoryScope): void {
  if (!scope?.tenantId?.trim() || !scope.storeId?.trim() || !scope.actorStaffId?.trim()) {
    throw new Error("缺少租户、门店或操作员工信息");
  }
}

function normalizedName(value: string): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new Error("分类名称必填");
  if (name.length > 40) throw new Error("分类名称不能超过 40 个字符");
  return name;
}

function normalizedDescription(value: string | null | undefined): string | null {
  const description = typeof value === "string" ? value.trim() : "";
  if (description.length > 500) throw new Error("分类说明不能超过 500 个字符");
  return description || null;
}

function normalizedSortOrder(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("排序值必须为整数");
  }
  return parsed;
}

/** Internal stable code: staff never type or edit it. */
function generateCategoryCode(): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `MC-${Date.now()}${random}`;
}

function result(category: MaterialCategoryResult): MaterialCategoryResult {
  return {
    id: category.id,
    code: category.code,
    name: category.name,
    description: category.description,
    sortOrder: category.sortOrder,
    active: category.active,
  };
}

async function recordAudit(
  tx: Prisma.TransactionClient,
  scope: MaterialCategoryScope,
  action: string,
  categoryId: string,
  beforeSnapshot?: Prisma.InputJsonValue,
  afterSnapshot?: Prisma.InputJsonValue,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action,
      entityType: "MaterialCategory",
      entityId: categoryId,
      beforeSnapshot,
      afterSnapshot,
    },
  });
}

async function loadCategory(
  tx: Prisma.TransactionClient,
  scope: MaterialCategoryScope,
  categoryId: string,
): Promise<MaterialCategoryResult> {
  const category = await tx.materialCategory.findFirst({
    where: { id: categoryId, tenantId: scope.tenantId },
  });
  if (!category) throw new Error("原材料分类不存在或不属于当前租户");
  return category;
}

export async function createMaterialCategory(
  tx: Prisma.TransactionClient,
  scope: MaterialCategoryScope,
  input: MaterialCategoryInput,
): Promise<MaterialCategoryResult> {
  assertScope(scope);
  const name = normalizedName(input.name);
  const description = normalizedDescription(input.description);
  const sortOrder = normalizedSortOrder(input.sortOrder);
  const active = input.active === undefined ? true : Boolean(input.active);

  const created = await tx.materialCategory.create({
    data: {
      tenantId: scope.tenantId,
      code: generateCategoryCode(),
      name,
      description,
      sortOrder,
      active,
    },
  });
  await recordAudit(tx, scope, "MATERIAL_CATEGORY_CREATED", created.id, undefined, {
    code: created.code,
    name: created.name,
    description: created.description,
    sortOrder: created.sortOrder,
    active: created.active,
  });
  return result(created);
}

export async function updateMaterialCategory(
  tx: Prisma.TransactionClient,
  scope: MaterialCategoryScope,
  categoryId: string,
  input: MaterialCategoryInput,
): Promise<MaterialCategoryResult> {
  assertScope(scope);
  const current = await loadCategory(tx, scope, categoryId);
  const name = normalizedName(input.name);
  const description = normalizedDescription(input.description);
  const sortOrder = normalizedSortOrder(input.sortOrder);

  const updated = await tx.materialCategory.update({
    where: { id: current.id },
    data: { name, description, sortOrder },
  });
  await recordAudit(
    tx,
    scope,
    "MATERIAL_CATEGORY_UPDATED",
    updated.id,
    { name: current.name, description: current.description, sortOrder: current.sortOrder },
    { name: updated.name, description: updated.description, sortOrder: updated.sortOrder },
  );
  return result(updated);
}

export async function setMaterialCategoryActive(
  tx: Prisma.TransactionClient,
  scope: MaterialCategoryScope,
  categoryId: string,
  active: boolean,
): Promise<MaterialCategoryResult> {
  assertScope(scope);
  const current = await loadCategory(tx, scope, categoryId);
  if (current.active === active) return result(current);

  const updated = await tx.materialCategory.update({
    where: { id: current.id },
    data: { active },
  });
  await recordAudit(
    tx,
    scope,
    active ? "MATERIAL_CATEGORY_ACTIVATED" : "MATERIAL_CATEGORY_DEACTIVATED",
    updated.id,
    { active: current.active },
    { active: updated.active },
  );
  return result(updated);
}

/**
 * Categories may only be deleted while no material references them; otherwise
 * the staff member is asked to move those materials first.
 */
export async function deleteMaterialCategory(
  tx: Prisma.TransactionClient,
  scope: MaterialCategoryScope,
  categoryId: string,
): Promise<void> {
  assertScope(scope);
  const current = await loadCategory(tx, scope, categoryId);
  const linked = await tx.materialCategoryRelation.count({ where: { categoryId: current.id } });
  if (linked > 0) {
    throw new Error(`该分类仍关联 ${linked} 个物料，不能删除；请先调整物料分类`);
  }
  await tx.materialCategory.delete({ where: { id: current.id } });
  await recordAudit(tx, scope, "MATERIAL_CATEGORY_DELETED", current.id, {
    code: current.code,
    name: current.name,
    description: current.description,
    sortOrder: current.sortOrder,
    active: current.active,
  });
}
