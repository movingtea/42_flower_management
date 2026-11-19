import {
  MaterialKind,
  Prisma,
  RecipeState,
  SampleState,
} from "../../generated/prisma-v2/client";
import { assertMaterialQuantity } from "../domain/stock-planning";
import { calculateSamplePricing } from "../domain/sample-pricing";
import { saveProduct, saveSku } from "./catalog-management";
import { saveRecipeDraft } from "./recipe-management";
import type { SampleScope } from "./sample-management";

export type SampleConversionLineInput = {
  materialId: string;
  quantity: number;
};

export type ConvertSampleToSkuInput = {
  sampleId: string;
  productId?: string | null;
  newProductName?: string | null;
  skuName: string;
  price?: number | null;
  targetMarginRate?: number | null;
  laborCost?: number;
  consumableCost?: number;
  lines?: SampleConversionLineInput[] | null;
};

export type ConvertSampleToSkuResult = {
  productId: string;
  productCode: string;
  skuId: string;
  skuCode: string;
  recipeId: string;
  recipeVersionId: string;
  price: number;
  materialCost: number;
  packagingCost: number;
  laborCost: number;
  suggestedPrice: number | null;
};

export type SkuListingCheck = {
  skuId: string;
  skuCode: string;
  productId: string;
  price: number;
  hasPublishedRecipe: boolean;
  hasDraftRecipe: boolean;
  active: boolean;
  ready: boolean;
  checks: { key: string; label: string; passed: boolean; detail: string }[];
};

function assertScope(scope: SampleScope): void {
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
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}必须为非负有限数`);
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) {
    throw new Error(`${label}最多保留两位小数`);
  }
  return value;
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

async function recordAudit(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  action: string,
  entityType: string,
  entityId: string,
  afterSnapshot: Prisma.InputJsonValue,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action,
      entityType,
      entityId,
      afterSnapshot,
    },
  });
}

async function resolveProduct(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  input: { productId?: string | null; newProductName?: string | null },
): Promise<{ id: string; code: string }> {
  if (input.productId) {
    const product = await tx.product.findFirst({
      where: { id: input.productId, tenantId: scope.tenantId },
      select: { id: true, code: true },
    });
    if (!product) throw new Error("商品不存在或不属于当前租户");
    return product;
  }
  const name = normalizedName(input.newProductName ?? "", "新商品名称");
  const created = await saveProduct(tx, { ...scope, actorStaffId: scope.actorStaffId }, {
    name,
    active: false,
  });
  return { id: created.id, code: created.code };
}

async function normalizeLines(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  sampleId: string,
  lines: SampleConversionLineInput[] | null | undefined,
): Promise<{ materialId: string; quantity: number }[]> {
  if (lines === null || lines === undefined) {
    const sample = await tx.sample.findFirst({
      where: { id: sampleId, tenantId: scope.tenantId },
      include: { materials: true },
    });
    if (!sample) throw new Error("样品不存在或不属于当前租户");
    if (sample.materials.length === 0) throw new Error("样品还没有花材搭配");
    return sample.materials.map((line) => ({
      materialId: line.materialId,
      quantity: Number(line.quantity),
    }));
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("SKU 配方至少需要一项物料");
  }
  const ids = lines.map((line) => {
    const materialId = typeof line?.materialId === "string" ? line.materialId.trim() : "";
    if (!materialId) throw new Error("SKU 配方物料不能为空");
    return materialId;
  });
  if (new Set(ids).size !== ids.length) throw new Error("同一物料不能在 SKU 配方中重复添加");
  const stored = await tx.material.findMany({
    where: { id: { in: ids }, tenantId: scope.tenantId },
    select: { id: true, name: true, quantityScale: true, kind: true },
  });
  if (stored.length !== ids.length) throw new Error("SKU 配方物料不存在或不属于当前租户");
  return lines.map((line, index) => {
    const materialId = ids[index]!;
    const material = stored.find((row) => row.id === materialId)!;
    const quantity = line.quantity;
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

async function lineCosts(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  lines: readonly { materialId: string; quantity: number }[],
): Promise<{
  materialCost: number;
  packagingCost: number;
  lineDetails: { materialId: string; name: string; quantity: number; unitCost: number; lineCost: number; kind: MaterialKind }[];
}> {
  const ids = lines.map((line) => line.materialId);
  const [materials, batches] = await Promise.all([
    tx.material.findMany({
      where: { id: { in: ids }, tenantId: scope.tenantId },
      select: { id: true, name: true, kind: true, standardUnitCost: true },
    }),
    tx.inventoryBatch.findMany({
      where: { storeId: scope.storeId, materialId: { in: ids } },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      select: { materialId: true, unitCost: true },
    }),
  ]);
  const batchCost = new Map<string, number>();
  for (const batch of batches) {
    if (!batchCost.has(batch.materialId)) batchCost.set(batch.materialId, Number(batch.unitCost));
  }
  let materialCost = 0;
  let packagingCost = 0;
  const lineDetails = lines.map((line) => {
    const material = materials.find((row) => row.id === line.materialId);
    if (!material) throw new Error("SKU 配方物料不存在或不属于当前租户");
    const unitCost = batchCost.get(material.id)
      ?? (material.standardUnitCost === null ? 0 : Number(material.standardUnitCost));
    const lineCost = Math.round((line.quantity * unitCost + 1e-9) * 100) / 100;
    if (material.kind === MaterialKind.PACKAGING || material.kind === MaterialKind.CONSUMABLE) {
      packagingCost += lineCost;
    } else {
      materialCost += lineCost;
    }
    return {
      materialId: material.id,
      name: material.name,
      quantity: line.quantity,
      unitCost,
      lineCost,
      kind: material.kind,
    };
  });
  return {
    materialCost: Math.round((materialCost + 1e-9) * 100) / 100,
    packagingCost: Math.round((packagingCost + 1e-9) * 100) / 100,
    lineDetails,
  };
}

async function convertToResolvedProduct(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  sample: {
    id: string;
    code: string;
    name: string;
    state: SampleState;
    targetMarginRate: Prisma.Decimal | null;
  },
  product: { id: string; code: string },
  input: ConvertSampleToSkuInput,
): Promise<ConvertSampleToSkuResult> {
  if (sample.state !== SampleState.READY) {
    throw new Error("只有已完成的样品可以转为可售 SKU，请先将样品标记完成");
  }
  const lines = await normalizeLines(tx, scope, sample.id, input.lines);
  const costs = await lineCosts(tx, scope, lines);
  const laborCost = money(input.laborCost ?? 0, "人工成本");
  // Packaging is part of the recipe, so it is costed through actual material use.
  // Only an explicitly supplied consumable estimate is stored separately; otherwise
  // the SKU would count packaging twice at production completion.
  const consumableCost = money(input.consumableCost ?? 0, "耗材成本");
  const margin = normalizeMargin(
    input.targetMarginRate === undefined
      ? (sample.targetMarginRate === null ? null : Number(sample.targetMarginRate))
      : input.targetMarginRate,
  );
  const pricing = calculateSamplePricing({
    materialCost: costs.materialCost,
    packagingCost: costs.packagingCost,
    laborCost,
    targetMarginRate: margin,
  });
  let price: number;
  if (input.price === null || input.price === undefined) {
    if (pricing.suggestedPrice === null) {
      throw new Error("请填写 SKU 售价或目标毛利率");
    }
    price = pricing.suggestedPrice;
  } else {
    price = money(input.price, "SKU 售价");
  }
  if (price <= 0) throw new Error("SKU 售价必须大于零");

  const skuName = normalizedName(input.skuName, "SKU 规格名称");
  const sku = await saveSku(tx, { ...scope, actorStaffId: scope.actorStaffId }, {
    productId: product.id,
    name: skuName,
    price,
    estimatedConsumableCost: consumableCost,
    estimatedLaborCost: laborCost,
    active: false,
    sourceSampleId: sample.id,
  });
  const recipe = await saveRecipeDraft(tx, { ...scope, actorStaffId: scope.actorStaffId }, {
    skuId: sku.id,
    lines,
  });
  await recordAudit(tx, scope, "SAMPLE_CONVERTED_TO_SKU", "Sample", sample.id, {
    sampleId: sample.id,
    sampleCode: sample.code,
    productId: product.id,
    productCode: product.code,
    skuId: sku.id,
    skuCode: sku.code,
    recipeId: recipe.recipeId,
    recipeVersionId: recipe.versionId,
    recipeVersionNo: recipe.versionNo,
    price,
    materialCost: costs.materialCost,
    packagingCost: costs.packagingCost,
    laborCost,
    targetMarginRate: margin,
    lines: costs.lineDetails,
  });
  return {
    productId: product.id,
    productCode: product.code,
    skuId: sku.id,
    skuCode: sku.code,
    recipeId: recipe.recipeId,
    recipeVersionId: recipe.versionId,
    price,
    materialCost: costs.materialCost,
    packagingCost: costs.packagingCost,
    laborCost,
    suggestedPrice: pricing.suggestedPrice,
  };
}

export async function convertSampleToSku(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  input: ConvertSampleToSkuInput,
): Promise<ConvertSampleToSkuResult> {
  assertScope(scope);
  const sampleId = typeof input.sampleId === "string" ? input.sampleId.trim() : "";
  if (!sampleId) throw new Error("样品标识不能为空");
  const sample = await tx.sample.findFirst({
    where: { id: sampleId, tenantId: scope.tenantId },
    select: { id: true, code: true, name: true, state: true, targetMarginRate: true },
  });
  if (!sample) throw new Error("样品不存在或不属于当前租户");
  const product = await resolveProduct(tx, scope, input);
  return convertToResolvedProduct(tx, scope, sample, product, input);
}

export type ConvertSamplesToProductInput = {
  sampleIds: string[];
  productId?: string | null;
  newProductName?: string | null;
  skuNamePrefix?: string | null;
  price?: number | null;
  targetMarginRate?: number | null;
  laborCost?: number;
  consumableCost?: number;
};

export async function convertSamplesToProduct(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  input: ConvertSamplesToProductInput,
): Promise<ConvertSampleToSkuResult[]> {
  assertScope(scope);
  const sampleIds = [...new Set(
    (input.sampleIds ?? []).map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean),
  )];
  if (sampleIds.length === 0) throw new Error("请选择至少一个样品");
  const samples = await tx.sample.findMany({
    where: { id: { in: sampleIds }, tenantId: scope.tenantId },
    select: { id: true, code: true, name: true, state: true, targetMarginRate: true },
    orderBy: { code: "asc" },
  });
  if (samples.length !== sampleIds.length) throw new Error("样品不存在或不属于当前租户");
  const product = await resolveProduct(tx, scope, input);
  const results: ConvertSampleToSkuResult[] = [];
  for (const sample of samples) {
    const prefix = input.skuNamePrefix?.trim();
    const skuName = prefix
      ? `${prefix} · ${sample.name}`.slice(0, 100)
      : `${sample.name} · ${sample.code}`.slice(0, 100);
    results.push(await convertToResolvedProduct(tx, scope, sample, product, {
      sampleId: sample.id,
      productId: product.id,
      skuName,
      price: input.price,
      targetMarginRate: input.targetMarginRate,
      laborCost: input.laborCost,
      consumableCost: input.consumableCost,
    }));
  }
  return results;
}

export async function getSkuListingCheck(
  tx: Prisma.TransactionClient,
  scope: SampleScope,
  skuId: string,
): Promise<SkuListingCheck> {
  const sku = await tx.productSku.findFirst({
    where: { id: skuId, product: { tenantId: scope.tenantId } },
    include: {
      product: { select: { id: true, code: true, active: true } },
      recipe: {
        include: {
          versions: {
            select: { id: true, versionNo: true, state: true, publishedAt: true },
            orderBy: { versionNo: "desc" },
          },
        },
      },
    },
  });
  if (!sku) throw new Error("SKU 不存在或不属于当前租户");
  const published = sku.recipe?.versions.find((version) => version.state === RecipeState.PUBLISHED) ?? null;
  const draft = sku.recipe?.versions.find((version) => version.state === RecipeState.DRAFT) ?? null;
  const price = Number(sku.price);
  const checks = [
    {
      key: "price",
      label: "售价",
      passed: price > 0,
      detail: price > 0 ? `¥${price.toFixed(2)}` : "请填写大于零的售价",
    },
    {
      key: "recipe",
      label: "已发布配方",
      passed: Boolean(published),
      detail: published ? `已发布 v${published.versionNo}` : draft ? `草稿 v${draft.versionNo} 待发布` : "缺少配方",
    },
    {
      key: "sample",
      label: "来源样品",
      passed: Boolean(sku.sourceSampleId),
      detail: sku.sourceSampleId ? "已记录来源样品" : "缺少来源样品",
    },
    {
      key: "product",
      label: "商品状态",
      passed: sku.product.active,
      detail: sku.product.active ? "商品已启用" : "商品尚未上架",
    },
    {
      key: "sku",
      label: "SKU 状态",
      passed: sku.active,
      detail: sku.active ? "SKU 已启用" : "SKU 尚未启用",
    },
  ];
  return {
    skuId: sku.id,
    skuCode: sku.code,
    productId: sku.productId,
    price,
    hasPublishedRecipe: Boolean(published),
    hasDraftRecipe: Boolean(draft),
    active: sku.active,
    ready: checks.every((check) => check.passed),
    checks,
  };
}
