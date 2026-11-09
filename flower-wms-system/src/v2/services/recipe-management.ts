import { Prisma, RecipeState } from "../../generated/prisma-v2/client";
import { assertMaterialQuantity } from "../domain/stock-planning";

export type RecipeScope = { tenantId: string; storeId: string; actorStaffId: string };
export type RecipeLineInput = { materialId: string; quantity: number };
export type SaveRecipeDraftInput = {
  skuId: string;
  versionId?: string;
  lines: RecipeLineInput[];
  effectiveAt?: Date | null;
};
export type SaveRecipeDraftResult = { recipeId: string; versionId: string; versionNo: number };
export type PublishRecipeVersionResult = {
  recipeId: string;
  versionId: string;
  versionNo: number;
  retiredVersionIds: string[];
};
export type RetireRecipeVersionResult = { recipeId: string; versionId: string; versionNo: number };

type ValidatedLine = { materialId: string; plannedQty: number };
type StoredRecipeLine = {
  materialId: string;
  plannedQty: Prisma.Decimal;
  material: { tenantId: string; quantityScale: number; name: string };
};
type AuditSnapshot = Prisma.InputJsonValue;

function assertScope(scope: RecipeScope): void {
  if (!scope?.tenantId?.trim() || !scope.storeId?.trim() || !scope.actorStaffId?.trim()) {
    throw new Error("缺少租户、门店或操作员工信息");
  }
}

function normalizeEffectiveAt(value: Date | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("配方生效时间无效");
  }
  return value;
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

async function recordAudit(
  tx: Prisma.TransactionClient,
  scope: RecipeScope,
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

async function lockRecipe(tx: Prisma.TransactionClient, recipeId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Recipe" WHERE id = ${recipeId} FOR UPDATE`;
}

async function lockRecipeVersion(tx: Prisma.TransactionClient, versionId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "RecipeVersion" WHERE id = ${versionId} FOR UPDATE`;
}

async function findVersionContext(
  tx: Prisma.TransactionClient,
  scope: RecipeScope,
  versionId: string,
): Promise<{ id: string; recipeId: string }> {
  const version = await tx.recipeVersion.findFirst({
    where: {
      id: versionId,
      recipe: { sku: { product: { tenantId: scope.tenantId } } },
    },
    select: { id: true, recipeId: true },
  });
  if (!version) throw new Error("配方版本不存在或不属于当前租户");
  return version;
}

async function validateLines(
  tx: Prisma.TransactionClient,
  scope: RecipeScope,
  lines: RecipeLineInput[],
): Promise<ValidatedLine[]> {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("配方至少需要一项物料");
  }
  const materialIds = lines.map((line) => {
    const materialId = typeof line?.materialId === "string" ? line.materialId.trim() : "";
    if (!materialId) throw new Error("配方物料不能为空");
    return materialId;
  });
  if (new Set(materialIds).size !== materialIds.length) {
    throw new Error("同一物料不能在配方中重复添加");
  }
  const materials = await tx.material.findMany({
    where: { id: { in: materialIds }, tenantId: scope.tenantId },
    select: { id: true, name: true, quantityScale: true, tenantId: true },
  });
  if (materials.length !== materialIds.length) {
    throw new Error("配方物料不存在或不属于当前租户");
  }
  return lines.map((line, index) => {
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
    return { materialId, plannedQty: quantity };
  });
}

/** Publishing re-reads persisted rows; draft input validation alone is not trusted. */
function revalidateStoredLines(lines: readonly StoredRecipeLine[], scope: RecipeScope): void {
  if (lines.length === 0) throw new Error("配方至少需要一项物料");
  const materialIds = lines.map((line) => line.materialId);
  if (new Set(materialIds).size !== materialIds.length) {
    throw new Error("同一物料不能在配方中重复添加");
  }
  for (const line of lines) {
    if (line.material.tenantId !== scope.tenantId) {
      throw new Error("配方物料不存在或不属于当前租户");
    }
    const quantity = Number(line.plannedQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`${line.material.name} 的用量必须大于零`);
    }
    try {
      assertMaterialQuantity(quantity, line.material.quantityScale);
    } catch {
      throw new Error(`${line.material.name} 的用量不符合物料计量精度`);
    }
  }
}

export async function saveRecipeDraft(
  tx: Prisma.TransactionClient,
  scope: RecipeScope,
  input: SaveRecipeDraftInput,
): Promise<SaveRecipeDraftResult> {
  assertScope(scope);
  const skuId = typeof input.skuId === "string" ? input.skuId.trim() : "";
  if (!skuId) throw new Error("SKU 不能为空");
  const sku = await tx.productSku.findFirst({
    where: { id: skuId, product: { tenantId: scope.tenantId } },
    select: { id: true },
  });
  if (!sku) throw new Error("SKU 不存在或不属于当前租户");
  const effectiveAt = normalizeEffectiveAt(input.effectiveAt);

  if (input.versionId !== undefined) {
    const versionId = typeof input.versionId === "string" ? input.versionId.trim() : "";
    if (!versionId) throw new Error("配方版本不能为空");
    const initial = await findVersionContext(tx, scope, versionId);
    await lockRecipe(tx, initial.recipeId);
    await lockRecipeVersion(tx, versionId);

    const version = await tx.recipeVersion.findFirst({
      where: {
        id: versionId,
        recipeId: initial.recipeId,
        recipe: { sku: { product: { tenantId: scope.tenantId } } },
      },
      select: {
        id: true,
        recipeId: true,
        versionNo: true,
        state: true,
        effectiveAt: true,
        recipe: { select: { skuId: true } },
        _count: { select: { lines: true } },
      },
    });
    if (!version) throw new Error("配方版本不存在或不属于当前租户");
    if (version.recipe.skuId !== sku.id) throw new Error("配方版本不属于该 SKU");
    if (version.state !== RecipeState.DRAFT) {
      throw new Error("已发布或已停用的配方版本不可修改，请新建草稿");
    }
    const lines = await validateLines(tx, scope, input.lines);
    const nextEffectiveAt = input.effectiveAt === undefined ? version.effectiveAt : effectiveAt;

    await tx.recipeLine.deleteMany({ where: { versionId } });
    await tx.recipeVersion.update({
      where: { id: versionId },
      data: { effectiveAt: nextEffectiveAt, lines: { create: lines } },
    });
    await recordAudit(
      tx,
      scope,
      "RECIPE_DRAFT_SAVED",
      "RecipeVersion",
      versionId,
      {
        versionNo: version.versionNo,
        state: version.state,
        lineCount: version._count.lines,
        effectiveAt: isoOrNull(version.effectiveAt),
      },
      {
        versionNo: version.versionNo,
        state: RecipeState.DRAFT,
        lineCount: lines.length,
        effectiveAt: isoOrNull(nextEffectiveAt),
      },
    );
    return { recipeId: version.recipeId, versionId, versionNo: version.versionNo };
  }

  const lines = await validateLines(tx, scope, input.lines);
  // A recipe row has a unique SKU, so serialize create-or-find across callers.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recipe:${scope.tenantId}:${sku.id}`}))`;
  let recipe = await tx.recipe.findUnique({ where: { skuId: sku.id }, select: { id: true } });
  if (!recipe) {
    try {
      recipe = await tx.recipe.create({ data: { skuId: sku.id }, select: { id: true } });
    } catch (error) {
      if ((error as { code?: unknown }).code !== "P2002") throw error;
      recipe = await tx.recipe.findUnique({ where: { skuId: sku.id }, select: { id: true } });
    }
  }
  if (!recipe) throw new Error("配方创建失败，请重试");
  await lockRecipe(tx, recipe.id);

  const latest = await tx.recipeVersion.findFirst({
    where: { recipeId: recipe.id },
    orderBy: { versionNo: "desc" },
    select: { versionNo: true },
  });
  const versionNo = (latest?.versionNo ?? 0) + 1;
  const version = await tx.recipeVersion.create({
    data: {
      recipeId: recipe.id,
      versionNo,
      state: RecipeState.DRAFT,
      effectiveAt,
      lines: { create: lines },
    },
    select: { id: true, versionNo: true },
  });
  await recordAudit(tx, scope, "RECIPE_DRAFT_SAVED", "RecipeVersion", version.id, undefined, {
    recipeId: recipe.id,
    skuId: sku.id,
    versionNo: version.versionNo,
    state: RecipeState.DRAFT,
    lineCount: lines.length,
    effectiveAt: isoOrNull(effectiveAt),
  });
  return { recipeId: recipe.id, versionId: version.id, versionNo: version.versionNo };
}

export async function publishRecipeVersion(
  tx: Prisma.TransactionClient,
  scope: RecipeScope,
  versionId: string,
): Promise<PublishRecipeVersionResult> {
  assertScope(scope);
  const id = typeof versionId === "string" ? versionId.trim() : "";
  if (!id) throw new Error("配方版本不能为空");
  const initial = await findVersionContext(tx, scope, id);
  await lockRecipe(tx, initial.recipeId);
  await lockRecipeVersion(tx, id);

  const version = await tx.recipeVersion.findFirst({
    where: {
      id,
      recipeId: initial.recipeId,
      recipe: { sku: { product: { tenantId: scope.tenantId } } },
    },
    include: {
      lines: {
        include: {
          material: { select: { tenantId: true, quantityScale: true, name: true } },
        },
      },
    },
  });
  if (!version) throw new Error("配方版本不存在或不属于当前租户");
  if (version.state !== RecipeState.DRAFT) {
    throw new Error("只有草稿配方版本可以发布");
  }
  revalidateStoredLines(version.lines, scope);

  const retired = await tx.recipeVersion.findMany({
    where: {
      recipeId: version.recipeId,
      state: RecipeState.PUBLISHED,
      id: { not: version.id },
    },
    select: { id: true },
  });
  const retiredVersionIds = retired.map((row) => row.id);
  if (retiredVersionIds.length > 0) {
    await tx.recipeVersion.updateMany({
      where: { id: { in: retiredVersionIds } },
      data: { state: RecipeState.RETIRED },
    });
  }

  const now = new Date();
  const effectiveAt = version.effectiveAt ?? now;
  const published = await tx.recipeVersion.update({
    where: { id: version.id },
    data: { state: RecipeState.PUBLISHED, publishedAt: now, effectiveAt },
    select: { id: true, versionNo: true, publishedAt: true, effectiveAt: true },
  });
  await recordAudit(
    tx,
    scope,
    "RECIPE_VERSION_PUBLISHED",
    "RecipeVersion",
    published.id,
    { state: version.state, versionNo: version.versionNo, lineCount: version.lines.length },
    {
      state: RecipeState.PUBLISHED,
      versionNo: published.versionNo,
      lineCount: version.lines.length,
      publishedAt: isoOrNull(published.publishedAt),
      effectiveAt: isoOrNull(published.effectiveAt),
      retiredVersionIds,
    },
  );
  return {
    recipeId: version.recipeId,
    versionId: published.id,
    versionNo: published.versionNo,
    retiredVersionIds,
  };
}

export async function retireRecipeVersion(
  tx: Prisma.TransactionClient,
  scope: RecipeScope,
  versionId: string,
): Promise<RetireRecipeVersionResult> {
  assertScope(scope);
  const id = typeof versionId === "string" ? versionId.trim() : "";
  if (!id) throw new Error("配方版本不能为空");
  const initial = await findVersionContext(tx, scope, id);
  await lockRecipe(tx, initial.recipeId);
  await lockRecipeVersion(tx, id);

  const version = await tx.recipeVersion.findFirst({
    where: {
      id,
      recipeId: initial.recipeId,
      recipe: { sku: { product: { tenantId: scope.tenantId } } },
    },
    select: { id: true, recipeId: true, versionNo: true, state: true },
  });
  if (!version) throw new Error("配方版本不存在或不属于当前租户");
  if (version.state !== RecipeState.PUBLISHED) {
    throw new Error("只有已发布的配方版本可以停用");
  }

  await tx.recipeVersion.update({
    where: { id: version.id },
    data: { state: RecipeState.RETIRED },
  });
  await recordAudit(
    tx,
    scope,
    "RECIPE_VERSION_RETIRED",
    "RecipeVersion",
    version.id,
    { state: version.state, versionNo: version.versionNo },
    { state: RecipeState.RETIRED, versionNo: version.versionNo },
  );
  return { recipeId: version.recipeId, versionId: version.id, versionNo: version.versionNo };
}
