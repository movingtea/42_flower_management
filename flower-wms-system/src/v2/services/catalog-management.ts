import { Prisma } from "../../generated/prisma-v2-draft/client";
import { generateProductCode, generateSkuCode } from "../domain/identifiers";

export type CatalogScope = { tenantId: string; storeId: string; actorStaffId: string };

export type SaveProductInput = {
  id?: string;
  name: string;
  active: boolean;
  defaultSkuId?: string | null;
  /** Edit only: exclusive list of SKUs to remain enabled/contained. undefined = leave current SKU active flags unchanged. */
  activeSkuIds?: string[];
};

export type SaveSkuInput = {
  id?: string;
  productId: string;
  name: string; // ProductSku.name is the user-facing 规格名称; never expose a code input
  price: number;
  estimatedConsumableCost: number;
  estimatedLaborCost: number;
  active: boolean;
  sourceSampleId?: string | null;
};

export type SaveProductResult = { id: string; code: string; active: boolean; defaultSkuId: string | null };
export type SaveSkuResult = { id: string; productId: string; code: string; active: boolean; defaultSkuId: string | null };

type SkuSummary = { id: string; code: string; active: boolean };
type ProductRecord = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  active: boolean;
  defaultSkuId: string | null;
  skus: SkuSummary[];
};
type AuditSnapshot = Prisma.InputJsonValue;

function assertScope(scope: CatalogScope): void {
  if (!scope?.tenantId?.trim() || !scope.storeId?.trim() || !scope.actorStaffId?.trim()) {
    throw new Error("缺少租户、门店或操作员工信息");
  }
}

function normalizedName(value: string, label: string): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new Error(`${label}必填`);
  if (name.length > 100) throw new Error(`${label}不能超过 100 个字符`);
  return name;
}

function money(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}必须为非负有限数`);
  }
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) {
    throw new Error(`${label}最多保留两位小数`);
  }
  return value;
}

async function recordAudit(
  tx: Prisma.TransactionClient,
  scope: CatalogScope,
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

// Every catalog mutation for a product locks the product row first, then its SKU rows.
// That makes the product the serialization point for the product/SKU/default invariant.
async function lockProduct(tx: Prisma.TransactionClient, productId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`;
}

async function lockProductSkus(tx: Prisma.TransactionClient, productId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "ProductSku" WHERE "productId" = ${productId} FOR UPDATE`;
}

async function lockSku(tx: Prisma.TransactionClient, skuId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "ProductSku" WHERE id = ${skuId} FOR UPDATE`;
}

async function loadProduct(
  tx: Prisma.TransactionClient,
  scope: CatalogScope,
  productId: string,
): Promise<ProductRecord> {
  const product = await tx.product.findFirst({
    where: { id: productId, tenantId: scope.tenantId },
    select: {
      id: true,
      tenantId: true,
      code: true,
      name: true,
      active: true,
      defaultSkuId: true,
      skus: { select: { id: true, code: true, active: true }, orderBy: { code: "asc" } },
    },
  });
  if (!product) throw new Error("商品不存在或不属于当前租户");
  return product;
}

async function loadSku(
  tx: Prisma.TransactionClient,
  scope: CatalogScope,
  skuId: string,
): Promise<{
  id: string;
  productId: string;
  code: string;
  name: string;
  active: boolean;
  sourceSampleId: string | null;
}> {
  const sku = await tx.productSku.findFirst({
    where: { id: skuId, product: { tenantId: scope.tenantId } },
    select: {
      id: true,
      productId: true,
      code: true,
      name: true,
      active: true,
      sourceSampleId: true,
    },
  });
  if (!sku) throw new Error("SKU 不存在或不属于当前租户");
  return sku;
}

async function assertSampleInTenant(
  tx: Prisma.TransactionClient,
  scope: CatalogScope,
  sampleId: string | null,
): Promise<void> {
  if (!sampleId) return;
  const sample = await tx.sample.findFirst({
    where: { id: sampleId, tenantId: scope.tenantId },
    select: { id: true },
  });
  if (!sample) throw new Error("来源样品不存在或不属于当前租户");
}

/** The current default wins while it is active; otherwise the lowest-code active SKU is promoted. */
function pickDefaultSku(skus: readonly SkuSummary[], currentDefaultSkuId: string | null): SkuSummary | null {
  const active = skus.filter((sku) => sku.active);
  if (active.length === 0) return null;
  const current = active.find((sku) => sku.id === currentDefaultSkuId);
  if (current) return current;
  return [...active].sort((left, right) => left.code.localeCompare(right.code))[0] ?? null;
}

function productResult(product: {
  id: string;
  code: string;
  active: boolean;
  defaultSkuId: string | null;
}): SaveProductResult {
  return {
    id: product.id,
    code: product.code,
    active: product.active,
    defaultSkuId: product.defaultSkuId,
  };
}

function skuResult(
  sku: { id: string; productId: string; code: string; active: boolean },
  defaultSkuId: string | null,
): SaveSkuResult {
  return {
    id: sku.id,
    productId: sku.productId,
    code: sku.code,
    active: sku.active,
    defaultSkuId,
  };
}

export async function saveProduct(
  tx: Prisma.TransactionClient,
  scope: CatalogScope,
  input: SaveProductInput,
): Promise<SaveProductResult> {
  assertScope(scope);
  const name = normalizedName(input.name, "商品名称");
  const active = Boolean(input.active);

  if (!input.id) {
    // A product cannot be enabled before its first SKU exists, so creation always starts disabled.
    if (active) throw new Error("商品启用前至少需要保留一个启用 SKU");
    if (input.defaultSkuId != null) throw new Error("默认 SKU 必须属于该商品且处于启用状态");
    if (input.activeSkuIds?.length) throw new Error("新建商品时不能指定启用 SKU");
    const product = await tx.product.create({
      data: {
        tenantId: scope.tenantId,
        code: generateProductCode(new Date(), crypto.randomUUID()),
        name,
        active: false,
        defaultSkuId: null,
      },
      select: { id: true, code: true, active: true, defaultSkuId: true },
    });
    await recordAudit(tx, scope, "PRODUCT_CREATED", "Product", product.id, undefined, {
      code: product.code,
      name,
      active: product.active,
      defaultSkuId: product.defaultSkuId,
    });
    return product;
  }

  const productId = input.id;
  await lockProduct(tx, productId);
  const current = await loadProduct(tx, scope, productId);
  await lockProductSkus(tx, productId);

  const exclusiveIds = input.activeSkuIds === undefined ? null : [...new Set(input.activeSkuIds)];
  if (exclusiveIds) {
    if (exclusiveIds.length > 0) {
      const foreign = await tx.productSku.findMany({
        where: { id: { in: exclusiveIds }, productId: { not: productId } },
        select: { id: true },
      });
      if (foreign.length > 0) {
        throw new Error("只能管理当前商品下的 SKU，不能包含其他商品的 SKU");
      }
    }
    const ownIds = new Set(current.skus.map((sku) => sku.id));
    if (exclusiveIds.some((id) => !ownIds.has(id))) {
      throw new Error("SKU 不存在或不属于当前商品");
    }
    if (exclusiveIds.length === 0) {
      await tx.productSku.updateMany({
        where: { productId, active: true },
        data: { active: false },
      });
    } else {
      await tx.productSku.updateMany({
        where: { productId, active: true, id: { notIn: exclusiveIds } },
        data: { active: false },
      });
      await tx.productSku.updateMany({
        where: { productId, active: false, id: { in: exclusiveIds } },
        data: { active: true },
      });
    }
  }

  const effectiveSkus: SkuSummary[] = current.skus.map((sku) => ({
    ...sku,
    active: exclusiveIds ? exclusiveIds.includes(sku.id) : sku.active,
  }));
  if (active && !effectiveSkus.some((sku) => sku.active)) {
    throw new Error("商品启用前至少需要保留一个启用 SKU");
  }

  let nextDefaultSkuId: string | null;
  if (input.defaultSkuId !== undefined) {
    if (input.defaultSkuId === null) {
      if (active) throw new Error("启用中的商品必须设置默认 SKU");
      nextDefaultSkuId = null;
    } else {
      const selected = effectiveSkus.find((sku) => sku.id === input.defaultSkuId && sku.active);
      if (!selected) throw new Error("默认 SKU 必须属于该商品且处于启用状态");
      nextDefaultSkuId = selected.id;
    }
  } else {
    const selected = pickDefaultSku(effectiveSkus, current.defaultSkuId);
    if (!selected && active) throw new Error("商品启用前至少需要保留一个启用 SKU");
    nextDefaultSkuId = selected?.id ?? null;
  }

  const updated = await tx.product.update({
    where: { id: productId },
    data: { name, active, defaultSkuId: nextDefaultSkuId },
    select: { id: true, code: true, active: true, defaultSkuId: true },
  });

  await recordAudit(
    tx,
    scope,
    "PRODUCT_UPDATED",
    "Product",
    updated.id,
    { name: current.name, active: current.active, defaultSkuId: current.defaultSkuId },
    { name, active: updated.active, defaultSkuId: updated.defaultSkuId },
  );
  if (current.active !== updated.active) {
    await recordAudit(
      tx,
      scope,
      updated.active ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED",
      "Product",
      updated.id,
      { active: current.active },
      { active: updated.active },
    );
  }
  if (current.defaultSkuId !== updated.defaultSkuId) {
    await recordAudit(
      tx,
      scope,
      "PRODUCT_DEFAULT_SKU_CHANGED",
      "Product",
      updated.id,
      { defaultSkuId: current.defaultSkuId },
      { defaultSkuId: updated.defaultSkuId },
    );
  }
  return productResult(updated);
}

export async function saveSku(
  tx: Prisma.TransactionClient,
  scope: CatalogScope,
  input: SaveSkuInput,
): Promise<SaveSkuResult> {
  assertScope(scope);
  const name = normalizedName(input.name, "SKU 规格名称");
  const price = money(input.price, "SKU 售价");
  const estimatedConsumableCost = money(input.estimatedConsumableCost, "SKU 预计耗材成本");
  const estimatedLaborCost = money(input.estimatedLaborCost, "SKU 预计人工成本");

  if (!input.id) {
    await lockProduct(tx, input.productId);
    const product = await loadProduct(tx, scope, input.productId);
    await lockProductSkus(tx, product.id);
    const sourceSampleId = input.sourceSampleId ?? null;
    await assertSampleInTenant(tx, scope, sourceSampleId);

    const created = await tx.productSku.create({
      data: {
        productId: product.id,
        code: generateSkuCode(new Date(), crypto.randomUUID()),
        name,
        price,
        estimatedConsumableCost,
        estimatedLaborCost,
        active: Boolean(input.active),
        sourceSampleId,
      },
      select: { id: true, productId: true, code: true, active: true },
    });

    const effectiveSkus: SkuSummary[] = [
      ...product.skus,
      { id: created.id, code: created.code, active: created.active },
    ];
    const selected = pickDefaultSku(effectiveSkus, product.defaultSkuId);
    if (product.active && !selected) throw new Error("商品启用前至少需要保留一个启用 SKU");
    let defaultSkuId = product.defaultSkuId;
    if ((selected?.id ?? null) !== (product.defaultSkuId ?? null)) {
      const updatedProduct = await tx.product.update({
        where: { id: product.id },
        data: { defaultSkuId: selected?.id ?? null },
        select: { defaultSkuId: true },
      });
      defaultSkuId = updatedProduct.defaultSkuId;
      await recordAudit(
        tx,
        scope,
        "PRODUCT_DEFAULT_SKU_CHANGED",
        "Product",
        product.id,
        { defaultSkuId: product.defaultSkuId },
        { defaultSkuId },
      );
    }

    await recordAudit(tx, scope, "SKU_CREATED", "ProductSku", created.id, undefined, {
      productId: created.productId,
      code: created.code,
      name,
      price,
      estimatedConsumableCost,
      estimatedLaborCost,
      active: created.active,
      sourceSampleId,
    });
    return skuResult(created, defaultSkuId);
  }

  const existing = await loadSku(tx, scope, input.id);
  if (existing.productId !== input.productId) {
    throw new Error("SKU 创建后不能变更所属商品");
  }
  await lockProduct(tx, existing.productId);
  await lockProductSkus(tx, existing.productId);
  const product = await loadProduct(tx, scope, existing.productId);
  const current = product.skus.find((sku) => sku.id === existing.id);
  if (!current) throw new Error("SKU 不存在或不属于当前商品");

  const sourceSampleId = input.sourceSampleId === undefined ? existing.sourceSampleId : input.sourceSampleId;
  await assertSampleInTenant(tx, scope, sourceSampleId);

  const plan = planSkuActiveChange(product, current.id, Boolean(input.active));
  let nextProduct = productResult(product);
  if (plan.nextProductActive !== product.active || plan.nextDefaultSkuId !== product.defaultSkuId) {
    const updatedProduct = await tx.product.update({
      where: { id: product.id },
      data: { active: plan.nextProductActive, defaultSkuId: plan.nextDefaultSkuId },
      select: { id: true, code: true, active: true, defaultSkuId: true },
    });
    nextProduct = productResult(updatedProduct);
  }

  const updated = await tx.productSku.update({
    where: { id: current.id },
    data: {
      name,
      price,
      estimatedConsumableCost,
      estimatedLaborCost,
      active: Boolean(input.active),
      sourceSampleId,
    },
    select: { id: true, productId: true, code: true, active: true },
  });

  await recordAudit(
    tx,
    scope,
    "SKU_UPDATED",
    "ProductSku",
    updated.id,
    { name: existing.name, active: current.active, sourceSampleId: existing.sourceSampleId },
    { name, price, estimatedConsumableCost, estimatedLaborCost, active: updated.active, sourceSampleId },
  );
  if (current.active !== updated.active) {
    await recordAudit(
      tx,
      scope,
      updated.active ? "SKU_ACTIVATED" : "SKU_DEACTIVATED",
      "ProductSku",
      updated.id,
      { active: current.active },
      { active: updated.active },
    );
  }
  if (plan.defaultChanged) {
    await recordAudit(
      tx,
      scope,
      "PRODUCT_DEFAULT_SKU_CHANGED",
      "Product",
      product.id,
      { defaultSkuId: product.defaultSkuId },
      { defaultSkuId: nextProduct.defaultSkuId },
    );
  }
  if (plan.productDeactivated) {
    await recordAudit(
      tx,
      scope,
      "PRODUCT_DEACTIVATED",
      "Product",
      product.id,
      { active: product.active },
      { active: false },
    );
  }
  return skuResult(updated, nextProduct.defaultSkuId);
}

export async function setDefaultSku(
  tx: Prisma.TransactionClient,
  scope: CatalogScope,
  productId: string,
  skuId: string,
): Promise<SaveProductResult> {
  assertScope(scope);
  await lockProduct(tx, productId);
  const product = await loadProduct(tx, scope, productId);
  await lockProductSkus(tx, productId);

  const sku = product.skus.find((item) => item.id === skuId);
  if (!sku || !sku.active) throw new Error("默认 SKU 必须属于该商品且处于启用状态");
  if (product.defaultSkuId === sku.id) return productResult(product);

  const updated = await tx.product.update({
    where: { id: product.id },
    data: { defaultSkuId: sku.id },
    select: { id: true, code: true, active: true, defaultSkuId: true },
  });
  await recordAudit(
    tx,
    scope,
    "PRODUCT_DEFAULT_SKU_CHANGED",
    "Product",
    updated.id,
    { defaultSkuId: product.defaultSkuId },
    { defaultSkuId: updated.defaultSkuId },
  );
  return productResult(updated);
}

export async function setProductActive(
  tx: Prisma.TransactionClient,
  scope: CatalogScope,
  productId: string,
  active: boolean,
): Promise<SaveProductResult> {
  assertScope(scope);
  await lockProduct(tx, productId);
  const product = await loadProduct(tx, scope, productId);
  await lockProductSkus(tx, productId);

  if (product.active === active) return productResult(product);

  const selected = pickDefaultSku(product.skus, product.defaultSkuId);
  if (active && !selected) throw new Error("商品启用前至少需要保留一个启用 SKU");
  if (active && product.skus.every((sku) => !sku.active)) {
    throw new Error("商品启用前至少需要保留一个启用 SKU");
  }

  const updated = await tx.product.update({
    where: { id: product.id },
    data: { active, defaultSkuId: selected?.id ?? null },
    select: { id: true, code: true, active: true, defaultSkuId: true },
  });
  await recordAudit(
    tx,
    scope,
    active ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED",
    "Product",
    updated.id,
    { active: product.active, defaultSkuId: product.defaultSkuId },
    { active: updated.active, defaultSkuId: updated.defaultSkuId },
  );
  if (product.defaultSkuId !== updated.defaultSkuId) {
    await recordAudit(
      tx,
      scope,
      "PRODUCT_DEFAULT_SKU_CHANGED",
      "Product",
      updated.id,
      { defaultSkuId: product.defaultSkuId },
      { defaultSkuId: updated.defaultSkuId },
    );
  }
  return productResult(updated);
}

export async function setSkuActive(
  tx: Prisma.TransactionClient,
  scope: CatalogScope,
  skuId: string,
  active: boolean,
): Promise<SaveSkuResult> {
  assertScope(scope);
  const existing = await loadSku(tx, scope, skuId);
  await lockProduct(tx, existing.productId);
  await lockSku(tx, existing.id);
  const product = await loadProduct(tx, scope, existing.productId);
  const current = product.skus.find((sku) => sku.id === existing.id);
  if (!current) throw new Error("SKU 不存在或不属于当前商品");

  if (current.active === active) return skuResult(existing, product.defaultSkuId);

  const plan = planSkuActiveChange(product, current.id, active);
  let nextProduct = productResult(product);
  if (plan.nextProductActive !== product.active || plan.nextDefaultSkuId !== product.defaultSkuId) {
    const updatedProduct = await tx.product.update({
      where: { id: product.id },
      data: { active: plan.nextProductActive, defaultSkuId: plan.nextDefaultSkuId },
      select: { id: true, code: true, active: true, defaultSkuId: true },
    });
    nextProduct = productResult(updatedProduct);
  }
  const updated = await tx.productSku.update({
    where: { id: current.id },
    data: { active },
    select: { id: true, productId: true, code: true, active: true },
  });

  await recordAudit(
    tx,
    scope,
    active ? "SKU_ACTIVATED" : "SKU_DEACTIVATED",
    "ProductSku",
    updated.id,
    { active: current.active },
    { active: updated.active },
  );
  if (plan.defaultChanged) {
    await recordAudit(
      tx,
      scope,
      "PRODUCT_DEFAULT_SKU_CHANGED",
      "Product",
      product.id,
      { defaultSkuId: product.defaultSkuId },
      { defaultSkuId: nextProduct.defaultSkuId },
    );
  }
  if (plan.productDeactivated) {
    await recordAudit(
      tx,
      scope,
      "PRODUCT_DEACTIVATED",
      "Product",
      product.id,
      { active: product.active },
      { active: false },
    );
  }
  return skuResult(updated, nextProduct.defaultSkuId);
}

type SkuActivePlan = {
  nextProductActive: boolean;
  nextDefaultSkuId: string | null;
  defaultChanged: boolean;
  productDeactivated: boolean;
};

function planSkuActiveChange(product: ProductRecord, skuId: string, active: boolean): SkuActivePlan {
  const effectiveSkus: SkuSummary[] = product.skus.map((sku) =>
    sku.id === skuId ? { ...sku, active } : sku,
  );
  const selected = pickDefaultSku(effectiveSkus, product.defaultSkuId);
  const nextDefaultSkuId = selected?.id ?? null;
  const hasActiveSku = effectiveSkus.some((sku) => sku.active);
  const nextProductActive = hasActiveSku ? product.active : false;
  return {
    nextProductActive,
    nextDefaultSkuId,
    defaultChanged: nextDefaultSkuId !== product.defaultSkuId,
    productDeactivated: product.active && !nextProductActive,
  };
}
